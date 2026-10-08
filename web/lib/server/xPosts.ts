import { randomBytes } from "node:crypto";
import { CHAIN_ID } from "../config";
import type { ActivityEvent } from "../clubs";
import type { ClubProfile } from "../clubPosts";
import { isOwnerOrAdmin, roleOf } from "../clubRoles";
import type { MemberRow } from "../members";
import {
  MAX_X_ACCOUNTS,
  X_CARD_TEXT_MAX,
  clubSignals,
  isXHandle,
  isXImage,
  matchSignals,
  parseXStatus,
  postedAtOf,
  strengthFactor,
  xStatusUrl,
  type ClubSignals,
  type SignalStrength,
  type XCard,
} from "../xPosts";
import { clubAssets, type AssetEntry, type ClubEntry } from "../verifiedAssets";
import { readCapped } from "./collectionScan";
import { adminIds, appendLog, loadProfile, loadRoles, saveProfile } from "./clubState";
import { loadLinkedAccounts, privyServerConfigured } from "./privy";
import { withinLimit, type Store } from "./store";
import { xUserIdOf } from "./xApi";

/**
 * X posts on a Club's Board (ADR 0024): the card a shared X post shows, the X shares that count
 * toward Momentum and the Holder bonus, and the project accounts an Owner links by a proof post.
 *
 * Reading a post costs nothing: X's public oEmbed endpoint gives its author and text. Reach (likes,
 * reposts…) needs the paid X API and is read once per epoch, in `xReach.ts`.
 */

export type XDeps = {
  /** Epoch ms. */
  now?: () => number;
  /** A public post's card, `null` when it doesn't exist or isn't public. Throws when X can't be asked. */
  lookupX?: (id: string) => Promise<XCard | null>;
  /** The member's linked X account (Privy), or `null`. */
  xAccountOf?: (userId: string) => Promise<{ username: string; subject: string } | null>;
  /** X's numeric id for a handle, when the X API is configured. */
  xUserIdOf?: (handle: string) => Promise<string | null>;
  admins?: ReadonlySet<string>;
};

const nowOf = (deps: XDeps) => deps.now?.() ?? Date.now();

// ─────────────────────────────────────────────────────────────── reading a post

const OEMBED = "https://publish.x.com/oembed";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_OEMBED_BYTES = 64 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…" };

/** Markup to plain text: tags out, line breaks to spaces, entities decoded. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
}

/** The card from an oEmbed answer, or `null` when it isn't one we can read. */
export function cardFromOembed(id: string, body: unknown): XCard | null {
  if (!body || typeof body !== "object") return null;
  const { author_url, html } = body as Record<string, unknown>;
  if (typeof author_url !== "string" || typeof html !== "string") return null;
  const author = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/.exec(author_url)?.[1];
  // The post's text is the blockquote's first paragraph; the rest is the byline and date.
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1];
  if (!author || paragraph === undefined) return null;
  // Control, zero-width and bidi characters out, as in a Board post's text (lib/clubPosts.ts).
  const text = plainText(paragraph)
    .replace(/[\u0000-\u001f\u007f-\u009f​‪-‮⁦-⁩﻿]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { id, author, text: [...text].slice(0, X_CARD_TEXT_MAX).join(""), postedAt: postedAtOf(id) };
}

/** The real lookup: X's oEmbed endpoint. Free and keyless; 404 for a deleted or private post. */
export async function oembedLookup(id: string): Promise<XCard | null> {
  const url = `${OEMBED}?url=${encodeURIComponent(xStatusUrl(id))}&omit_script=1&dnt=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
  if (res.status === 404 || res.status === 403) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`oEmbed answered ${res.status}`);
  }
  const text = await readCapped(res, MAX_OEMBED_BYTES);
  if (text === null) throw new Error("oEmbed answer too large");
  const card = cardFromOembed(id, JSON.parse(text));
  if (!card) return null;
  // oEmbed has no media, only a "pic.twitter.com/…" link in the text: ask the syndication endpoint.
  const image = await syndicationImage(id).catch(() => undefined);
  if (!image) return card;
  // The trailing link only points at the media we now draw.
  const stripped = card.text.replace(/(?:\s*https?:\/\/t\.co\/\w+)?\s*pic\.(?:twitter|x)\.com\/\w+\s*$/i, "").replace(/\s*https?:\/\/t\.co\/\w+\s*$/i, "").trim();
  return { ...card, text: stripped || card.text, image };
}

const SYNDICATION = "https://cdn.syndication.twimg.com/tweet-result";

/** The first photo (or a video's poster) of a post, from X's keyless embed endpoint; best effort. */
export async function syndicationImage(id: string): Promise<string | undefined> {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const res = await fetch(`${SYNDICATION}?id=${id}&token=${token}&lang=en`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return undefined;
  }
  const text = await readCapped(res, MAX_OEMBED_BYTES * 8);
  return text === null ? undefined : imageFromSyndication(JSON.parse(text));
}

/** The image URL in a syndication answer, only when it is on X's image host. */
export function imageFromSyndication(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { mediaDetails, photos } = body as { mediaDetails?: { media_url_https?: unknown }[]; photos?: { url?: unknown }[] };
  const found = [mediaDetails?.[0]?.media_url_https, photos?.[0]?.url].find(isXImage);
  return found;
}

/** The member's X account as Privy verified it: its handle and X's numeric id. */
export async function privyXAccount(userId: string): Promise<{ username: string; subject: string } | null> {
  if (!privyServerConfigured) return null;
  const accounts = await loadLinkedAccounts(userId).catch(() => null);
  const x = accounts?.find((a) => a.type === "twitter_oauth") as { username?: unknown; subject?: unknown } | undefined;
  return x && typeof x.username === "string" && typeof x.subject === "string" ? { username: x.username, subject: x.subject } : null;
}

// ─────────────────────────────────────────────────────────────── X shares

/** One member's own X post about the Club, shared on its Board. */
export type XShare = {
  tweet: string;
  club: string;
  userId: string;
  /** The member's Club wallet when they shared it: the party Momentum credits. */
  wallet: string;
  postId: string;
  /** Unix seconds it was shared. */
  at: number;
  /** How strongly it was about the Club when shared; the epoch's reach read has the last word. */
  strength: SignalStrength;
  /** The Board post was hidden: it counts for nothing until restored. */
  hidden?: true;
  /** The Board post is a challenge entry (ADR 0048): Momentum counts it, epoch points don't. */
  entry?: string;
};

const base = `declub:xshare:${CHAIN_ID}`;
export const xSharesKey = (club: string) => `declub:xshares:${CHAIN_ID}:${club.toLowerCase()}`;
export const xShareKey = (club: string, tweet: string) => `${base}:${club.toLowerCase()}:${tweet}`;
const seenKey = (tweet: string) => `declub:xshare-seen:${CHAIN_ID}:${tweet}`;
const xLinkKey = (club: string, handle: string) => `declub:xlink:${CHAIN_ID}:${club.toLowerCase()}:${handle.toLowerCase()}`;

/** How old an X post may be when it's shared and still count. */
export const X_SHARE_MAX_AGE_MS = 48 * 3_600_000;
/** The rate limit that keeps a member to X_SHARES_PER_DAY in a Club on UTC day `day`. */
const xShareDayLimit = (club: string, day: number) => `xshare-day:${club.toLowerCase()}:${day}`;
/** How many of a member's X posts count per Club per UTC day. */
export const X_SHARES_PER_DAY = 1;
/** X shares kept per Club. A busy Club fills this in months, and Momentum reads 30 days. */
const X_SHARES_KEPT = 5_000;
/** An X post counts once ever; this is how long that is remembered. */
const SEEN_SEC = 365 * 86_400;

export type XShareVerdict = { own: boolean; counted: SignalStrength | null; reason?: "not_own" | "not_holder" | "too_old" | "no_signal" | "daily_limit" | "already_counted" };

/** A Club's signals: its assets' addresses and tickers, its linked accounts and its tags. */
export const signalsOf = (entry: ClubEntry, profile: ClubProfile): ClubSignals => clubSignals(clubAssets(entry), profile.x);

/**
 * Records a shared X post as an X share if it counts: the member's own (their linked X account), by
 * a Holder, at most 48 hours old, about the Club, never counted before, and the member's first
 * today in this Club. Otherwise it is just a card, and the verdict says why.
 */
export async function recordXShare(
  store: Store,
  entry: ClubEntry,
  input: { userId: string; row: MemberRow; postId: string; card: XCard },
  deps: XDeps = {},
): Promise<XShareVerdict> {
  const token = entry.address.toLowerCase();
  const account = await (deps.xAccountOf ?? privyXAccount)(input.userId).catch(() => null);
  const own = !!account && account.username.toLowerCase() === input.card.author.toLowerCase();
  if (!own) return { own, counted: null, reason: "not_own" };
  if (!input.row.holder) return { own, counted: null, reason: "not_holder" };
  const now = nowOf(deps);
  if (input.card.postedAt === null || now - input.card.postedAt > X_SHARE_MAX_AGE_MS) return { own, counted: null, reason: "too_old" };
  const strength = matchSignals(signalsOf(entry, await loadProfile(store, token)), { text: input.card.text });
  if (!strength) return { own, counted: null, reason: "no_signal" };

  const day = Math.floor(now / 86_400_000);
  if (!(await withinLimit(store, xShareDayLimit(token, day), input.userId, X_SHARES_PER_DAY, 2 * 86_400))) {
    return { own, counted: null, reason: "daily_limit" };
  }
  if ((await store.hit(seenKey(input.card.id), SEEN_SEC)) > 1) return { own, counted: null, reason: "already_counted" };

  const share: XShare = { tweet: input.card.id, club: token, userId: input.userId, wallet: input.row.displayWallet, postId: input.postId, at: Math.floor(now / 1000), strength };
  await store.set(xShareKey(token, share.tweet), share);
  await store.rank(xSharesKey(token), [{ member: share.tweet, score: share.at }], X_SHARES_KEPT);
  return { own, counted: strength };
}

/** Hiding the Board post stops its X share counting; restoring it counts again. */
export async function setXShareHidden(store: Store, club: string, tweet: string, postId: string, hidden: boolean): Promise<void> {
  const share = await store.get<XShare>(xShareKey(club, tweet));
  // Only the post that counted it: another post sharing the same X post never did.
  if (!share || share.postId !== postId) return;
  const next: XShare = { ...share };
  if (hidden) next.hidden = true;
  else delete next.hidden;
  await store.set(xShareKey(club, tweet), next);
}

/** Deleting the Board post deletes its X share. It stays "seen": it can't be counted again. */
export async function removeXShare(store: Store, club: string, tweet: string, postId: string): Promise<void> {
  const share = await store.get<XShare>(xShareKey(club, tweet));
  if (share?.postId === postId) await store.del(xShareKey(club, tweet));
}

/** Everything a Club's X shares keep, for the purge. */
export async function purgeXShares(store: Store, club: string): Promise<void> {
  const tweets = await store.ranked(xSharesKey(club), X_SHARES_KEPT);
  await store.del(...tweets.map((t) => xShareKey(club, t)), xSharesKey(club));
}

/** A Club's live X shares, newest first. */
export async function readXShares(store: Store, club: string, limit = X_SHARES_KEPT): Promise<XShare[]> {
  const tweets = await store.ranked(xSharesKey(club), limit);
  const rows = await store.getMany<XShare>(tweets.map((t) => xShareKey(club, t)));
  return rows.filter((s): s is XShare => s !== null && !s.hidden);
}

/** X shares as activity events, for Momentum (`lib/server/clubs.ts`). */
export function xShareEvents(shares: readonly XShare[]): ActivityEvent[] {
  return shares.map((s) => ({
    id: `x:${s.tweet}`,
    kind: "xshare" as const,
    contract: "",
    deal: s.tweet,
    block: 0,
    at: s.at,
    parties: [s.wallet.toLowerCase()],
    tokens: [s.club],
    weight: strengthFactor(s.strength),
    ...(s.entry ? { entry: true as const } : {}),
  }));
}

/**
 * Marks the X share of Board post `postId` as a challenge entry (ADR 0048), or clears the mark with
 * `challenge: null`. Marking gives the member back today's X-share slot: an entry earns through its
 * challenge, so it shouldn't stop their next X post from counting.
 */
export async function setXShareEntry(store: Store, club: string, tweet: string, postId: string, challenge: string | null): Promise<void> {
  const share = await store.get<XShare>(xShareKey(club, tweet));
  if (!share || share.postId !== postId || (share.entry ?? null) === challenge) return;
  const next: XShare = { ...share };
  if (challenge) next.entry = challenge;
  else delete next.entry;
  await store.set(xShareKey(club, tweet), next);
  // One X share counts a day (X_SHARES_PER_DAY), and this was it: clearing the day's count frees the slot.
  if (challenge && !share.entry) await store.del(`declub:rl:${xShareDayLimit(club, Math.floor(share.at / 86_400))}:${share.userId}`);
}

// ─────────────────────────────────────────────────────────────── linking the project's account

export type XLinkRefusal =
  | "forbidden" | "archived" | "bad_handle" | "already_linked" | "too_many_accounts" | "rate_limited"
  | "xlink_expired" | "xlink_mismatch" | "xlink_unavailable" | "invalid" | "not_found";

/** How long a proof code stays good. */
export const X_LINK_TTL_MS = 24 * 3_600_000;

type Pending = { code: string; by: string; until: number };

const isAdmin = (deps: XDeps, userId: string) => (deps.admins ?? adminIds()).has(userId);

async function mayManage(store: Store, token: string, userId: string, deps: XDeps): Promise<boolean> {
  return isOwnerOrAdmin(roleOf(await loadRoles(store, token), userId, isAdmin(deps, userId)));
}

/** The text the project account posts to prove the link. */
export const proofText = (handle: string, club: string, code: string) => `Linking @${handle} to its DeClub Club ${club} · code ${code}`;

/**
 * Step 1: the Owner names the project's X account and gets a code to post from it. A typed handle
 * proves nothing; the post does.
 */
export async function startXLink(
  store: Store,
  entry: AssetEntry,
  actor: { userId: string },
  handle: unknown,
  deps: XDeps = {},
): Promise<{ ok: true; handle: string; code: string; text: string; until: number } | { ok: false; reason: XLinkRefusal }> {
  const token = entry.address.toLowerCase();
  if (!(await mayManage(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const name = typeof handle === "string" ? handle.trim().replace(/^@/, "") : "";
  if (!isXHandle(name)) return { ok: false, reason: "bad_handle" };
  const accounts = (await loadProfile(store, token)).x?.accounts ?? [];
  if (accounts.some((a) => a.handle.toLowerCase() === name.toLowerCase())) return { ok: false, reason: "already_linked" };
  if (accounts.length >= MAX_X_ACCOUNTS) return { ok: false, reason: "too_many_accounts" };
  if (!(await withinLimit(store, `xlink:${token}`, actor.userId, 10, 3600))) return { ok: false, reason: "rate_limited" };

  const code = randomBytes(3).toString("hex");
  const until = nowOf(deps) + X_LINK_TTL_MS;
  await store.set(xLinkKey(token, name), { code, by: actor.userId, until } satisfies Pending);
  return { ok: true, handle: name, code, text: proofText(name, entry.address, code), until };
}

/**
 * Step 2: the Owner pastes the proof post's link. It must be by that account and carry the code.
 * The link is then kept with the post's id, so anyone can look; the post itself may be deleted.
 */
export async function verifyXLink(
  store: Store,
  entry: AssetEntry,
  actor: { userId: string; wallet: string },
  input: { handle: unknown; url: unknown },
  deps: XDeps = {},
): Promise<{ ok: true; profile: ClubProfile } | { ok: false; reason: XLinkRefusal }> {
  const token = entry.address.toLowerCase();
  if (!(await mayManage(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const name = typeof input.handle === "string" ? input.handle.trim().replace(/^@/, "") : "";
  if (!isXHandle(name)) return { ok: false, reason: "bad_handle" };
  const id = parseXStatus(input.url);
  if (!id) return { ok: false, reason: "invalid" };
  if (!(await withinLimit(store, `xlink:${token}`, actor.userId, 10, 3600))) return { ok: false, reason: "rate_limited" };

  const pending = await store.get<Pending>(xLinkKey(token, name));
  if (!pending || pending.until < nowOf(deps)) return { ok: false, reason: "xlink_expired" };
  let card: XCard | null;
  try {
    card = await (deps.lookupX ?? oembedLookup)(id);
  } catch {
    return { ok: false, reason: "xlink_unavailable" };
  }
  if (!card || card.author.toLowerCase() !== name.toLowerCase() || !card.text.includes(pending.code)) return { ok: false, reason: "xlink_mismatch" };

  const profile = await loadProfile(store, token);
  const accounts = profile.x?.accounts ?? [];
  if (accounts.length >= MAX_X_ACCOUNTS) return { ok: false, reason: "too_many_accounts" };
  if (accounts.some((a) => a.handle.toLowerCase() === name.toLowerCase())) return { ok: false, reason: "already_linked" };
  const xUserId = await (deps.xUserIdOf ?? xUserIdOf)(card.author).catch(() => null);
  const next: ClubProfile = {
    ...profile,
    x: {
      accounts: [...accounts, { handle: card.author, proof: id, linkedAt: nowOf(deps), ...(xUserId ? { xUserId } : {}) }],
      tags: profile.x?.tags ?? [],
    },
  };
  await saveProfile(store, token, next);
  await store.del(xLinkKey(token, name));
  await appendLog(store, token, { actor: actor.wallet, action: "link_x", target: `@${card.author}` }, nowOf(deps));
  return { ok: true, profile: next };
}

/** The Owner or an admin unlinks a project account. */
export async function unlinkX(
  store: Store,
  entry: AssetEntry,
  actor: { userId: string; wallet: string },
  handle: unknown,
  deps: XDeps = {},
): Promise<{ ok: true; profile: ClubProfile } | { ok: false; reason: XLinkRefusal }> {
  const token = entry.address.toLowerCase();
  if (!(await mayManage(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  const name = typeof handle === "string" ? handle.trim().replace(/^@/, "").toLowerCase() : "";
  const profile = await loadProfile(store, token);
  const accounts = profile.x?.accounts ?? [];
  if (!accounts.some((a) => a.handle.toLowerCase() === name)) return { ok: false, reason: "not_found" };
  const next: ClubProfile = { ...profile, x: { accounts: accounts.filter((a) => a.handle.toLowerCase() !== name), tags: profile.x?.tags ?? [] } };
  await saveProfile(store, token, next);
  await appendLog(store, token, { actor: actor.wallet, action: "unlink_x", target: `@${name}` }, nowOf(deps));
  return { ok: true, profile: next };
}
