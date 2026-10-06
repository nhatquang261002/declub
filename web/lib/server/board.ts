import { randomUUID } from "node:crypto";
import { createPublicClient, getAddress, http, parseAbi, verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { chain } from "../chain";
import { CHAIN_ID, DECLUB_ESCROW_ADDRESS, RPC_URL } from "../config";
import {
  MAX_PINNED,
  POSTS_KEPT,
  POSTS_PER_HOUR,
  POSTS_SHOWN,
  POST_COOLDOWN_SEC,
  REPORTS_PER_DAY,
  REPORTS_TO_HIDE,
  checkProfileEdit,
  cleanText,
  parseLink,
  pinnedFirst,
  viewPost,
  type ClubProfile,
  type PostKind,
  type PostLink,
  type PublicPost,
  type StoredPost,
} from "../clubPosts";
import { applyRole, atLeast, isOwnerOrAdmin, isStaff, mayActOn, roleOf, type ClubRole, type RoleChange } from "../clubRoles";
import { toAsset } from "../assets";
import { getIntent } from "../pool";
import { lensOf, type LensContext, type LensId } from "../lenses";
import { memberScore, score } from "../momentum";
import { toScored } from "../clubs";
import { SIGNED_SKEW_SEC, linkString, postId, postTypedData, type PostMessage, type SignedPost } from "../social";
import { clubAssets, type AssetEntry, type ClubEntry } from "../verifiedAssets";
import { activityKey, viemReader } from "./activity";
import { clubEvents } from "./clubs";
import { followingOf } from "./follows";
import {
  ALL,
  adminIds,
  appendLog,
  banKey,
  banRole,
  clubProfileKey,
  isBanned,
  loadBans,
  loadProfile,
  loadRoles,
  logKey,
  rolesKey,
  saveBans,
  saveProfile,
  saveRoles,
  type Ban,
} from "./clubState";
import { allRows, getMember, leaveClub, memberKey, membersKey, sharedWallets, userClubsKey } from "./members";
import { withinLimit, type Store } from "./store";

/**
 * The Club's board and its staff (ADR 0016, docs/09-clubs.md): posts, reports, bans, roles, the
 * Owner's claim and profile, and the purge. Every function takes the store and the Club, so the
 * rules run against an in-memory store in tests. Each refusal is a reason code the routes map to
 * a status and a sentence.
 */
export type Deps = {
  /** App admins' user ids; defaults to CLUB_ADMIN_USER_IDS. */
  admins?: ReadonlySet<string>;
  /** Epoch ms. */
  now?: () => number;
  /** The token contract's `owner()`, or `null` when it has none. */
  ownerOf?: (token: Address) => Promise<string | null>;
  /** The tokens a deal or intent names, `null` when it doesn't exist. Throws when the lookup fails. */
  resolveLink?: (link: PostLink) => Promise<string[] | null>;
  /**
   * Whether `signature` is `signer`'s over the post. viem's check in production, which also asks a
   * smart wallet (ERC-1271); tests use a local signer.
   */
  verifyPost?: (signer: Address, message: PostMessage, signature: Hex) => Promise<boolean>;
};

/** Who is acting: their Privy user id and a wallet to name them by in the log. */
export type Actor = { userId: string; wallet: string };

const nowOf = (deps: Deps) => deps.now?.() ?? Date.now();
const isAdmin = (deps: Deps, userId: string) => (deps.admins ?? adminIds()).has(userId);

export const postsKey = (token: string) => `declub:club-posts:${CHAIN_ID}:${token.toLowerCase()}`;
export const postKey = (token: string, id: string) => `declub:club-post:${CHAIN_ID}:${token.toLowerCase()}:${id}`;
export const reportsKey = (token: string, id: string) => `declub:club-reports:${CHAIN_ID}:${token.toLowerCase()}:${id}`;
/** Every signed post a wallet wrote, across Clubs, as `club:id`, newest first. */
export const walletPostsKey = (wallet: string) => `declub:wallet-posts:${CHAIN_ID}:${wallet.toLowerCase()}`;
/** The reports that count toward hiding a post: those filed by Holders and staff. */
export const countedReportsKey = (token: string, id: string) => `declub:club-reports-counted:${CHAIN_ID}:${token.toLowerCase()}:${id}`;

/** The user's role in the Club, an app admin's outranking everything. */
export async function roleIn(store: Store, token: string, userId: string, deps: Deps = {}): Promise<ClubRole> {
  return roleOf(await loadRoles(store, token), userId, isAdmin(deps, userId));
}

const log = (store: Store, entry: AssetEntry, actor: Actor, action: string, target?: string, detail?: string) =>
  appendLog(store, entry.address, { actor: actor.wallet, action, ...(target ? { target } : {}), ...(detail ? { detail } : {}) });

// ---------------------------------------------------------------------------------------------
// Links: a "Looking for" post may point at a deal or a signed swap, which must name the Club's token.

const tokensOf = (assets: readonly { kind: string; token?: string }[]) =>
  assets.filter((a) => a.kind !== "native" && a.token).map((a) => a.token!.toLowerCase());

/** The real lookup: V2's `getTrade`, or the pool's intent. */
export async function resolveLink(link: PostLink): Promise<string[] | null> {
  if (link.kind === "intent") {
    const found = await getIntent(link.hash as `0x${string}`);
    return found ? tokensOf([...found.intent.give, ...found.intent.want]) : null;
  }
  if (!DECLUB_ESCROW_ADDRESS) return null;
  try {
    const trade = await viemReader().trade(DECLUB_ESCROW_ADDRESS, BigInt(link.id));
    const assets = [...trade.offered, ...trade.requested];
    if (assets.length === 0) return null;
    return tokensOf(assets.map(toAsset).filter((a) => a !== null));
  } catch {
    // `getTrade` reverts for an id that was never created.
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Posts

export type PostRefusal =
  | "archived" | "not_member" | "banned" | "no_profile" | "holders_only" | "bad_kind" | "empty" | "too_long"
  | "bad_link" | "link_not_found" | "link_mismatch" | "link_unavailable" | "cooldown" | "rate_limited";

export type PostInput = {
  kind: unknown;
  text: unknown;
  link?: unknown;
  /** A post `createSignedPost` checked: it takes the message's id and keeps the signature. */
  signed?: { message: PostMessage; signature: Hex };
};

export async function createPost(
  store: Store,
  entry: ClubEntry,
  userId: string,
  input: PostInput,
  deps: Deps = {},
): Promise<{ ok: true; post: PublicPost } | { ok: false; reason: PostRefusal }> {
  const token = entry.address.toLowerCase();
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const row = await getMember(store, token, userId);
  if (!row) return { ok: false, reason: "not_member" };
  if (await isBanned(store, token, userId)) return { ok: false, reason: "banned" };

  const role = await roleIn(store, token, userId, deps);
  const profile = await loadProfile(store, token);
  // Staff post whatever the Owner has switched on: it is for members.
  if (profile.holdersOnlyPosts && !row.holder && !isStaff(role)) return { ok: false, reason: "holders_only" };
  if ((await sharedWallets(store, userId)).size === 0) return { ok: false, reason: "no_profile" };

  if (input.kind !== "note" && input.kind !== "looking") return { ok: false, reason: "bad_kind" };
  const kind: PostKind = input.kind;
  const text = cleanText(input.text);
  if (!text.ok) return { ok: false, reason: text.reason };

  let link: PostLink | undefined;
  if (input.link !== undefined && input.link !== null && input.link !== "") {
    const parsed = kind === "looking" ? parseLink(input.link) : null;
    if (!parsed) return { ok: false, reason: "bad_link" };
    let tokens: string[] | null;
    try {
      tokens = await (deps.resolveLink ?? resolveLink)(parsed);
    } catch {
      return { ok: false, reason: "link_unavailable" };
    }
    if (!tokens) return { ok: false, reason: "link_not_found" };
    // Either asset of a paired Club will do: a CHOG deal belongs on the Chogs' board.
    if (!clubAssets(entry).some((asset) => tokens.includes(asset.address.toLowerCase()))) return { ok: false, reason: "link_mismatch" };
    link = parsed;
  }

  // Limits last, so a post the server would refuse anyway doesn't use one up.
  if (!(await withinLimit(store, `club-post-cd:${token}`, userId, 1, POST_COOLDOWN_SEC))) return { ok: false, reason: "cooldown" };
  if (!(await withinLimit(store, `club-post-hr:${token}`, userId, POSTS_PER_HOUR, 3600))) return { ok: false, reason: "rate_limited" };

  const post: StoredPost = {
    id: input.signed ? postId(input.signed.message) : randomUUID().replaceAll("-", ""),
    userId,
    wallet: row.displayWallet,
    kind,
    text: text.text,
    ...(link ? { link } : {}),
    at: nowOf(deps),
    ...(input.signed ? { signed: { signature: input.signed.signature, at: input.signed.message.at } } : {}),
  };
  await store.set(postKey(token, post.id), post);
  await store.rank(postsKey(token), [{ member: post.id, score: post.at }], POSTS_KEPT);
  if (post.signed) {
    await store.rank(walletPostsKey(post.wallet), [{ member: `${token}:${post.id}`, score: post.at }], POSTS_KEPT);
  }
  return { ok: true, post: viewPost(post, { userId, staff: isStaff(role) }, false) };
}

export type SignedPostRefusal = PostRefusal | "unsigned" | "wrong_club" | "not_clean" | "stale" | "bad_signature" | "wrong_signer";

let verifier: PublicClient | undefined;
/** viem's check: an EOA's signature, or a smart wallet's through ERC-1271. */
async function viemVerifyPost(signer: Address, message: PostMessage, signature: Hex): Promise<boolean> {
  // A plain wallet's signature is checked here; only a smart wallet costs a call (ERC-1271).
  if (await verifyTypedData({ address: signer, signature, ...postTypedData(message) }).catch(() => false)) return true;
  verifier ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;
  try {
    if (!(await verifier.getCode({ address: signer }))) return false;
    return await verifier.verifyTypedData({ address: signer, signature, ...postTypedData(message) });
  } catch {
    return false;
  }
}

/**
 * A post the author signed (ADR 0023). The message must be exactly what `createPost` would store,
 * for this Club, signed within a few minutes, by the member's Club wallet; then every Board rule
 * applies as for any post. Sending the same signed post twice gives back the first.
 */
export async function createSignedPost(
  store: Store,
  entry: ClubEntry,
  userId: string,
  body: { message: PostMessage | null; signature: unknown },
  deps: Deps = {},
): Promise<{ ok: true; post: PublicPost } | { ok: false; reason: SignedPostRefusal }> {
  const { message, signature } = body;
  if (!message || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return { ok: false, reason: "unsigned" };
  const token = entry.address.toLowerCase();
  if (message.club.toLowerCase() !== token) return { ok: false, reason: "wrong_club" };
  // What was signed must be what is stored: the cleaned text, and the link in canonical form.
  const text = cleanText(message.text);
  if (!text.ok) return { ok: false, reason: text.reason };
  if (text.text !== message.text) return { ok: false, reason: "not_clean" };
  if (message.link !== "") {
    const parsed = message.kind === "looking" ? parseLink(message.link) : null;
    if (!parsed) return { ok: false, reason: "bad_link" };
    if (linkString(parsed) !== message.link) return { ok: false, reason: "not_clean" };
  }
  if (Math.abs(message.at - Math.floor(nowOf(deps) / 1000)) > SIGNED_SKEW_SEC) return { ok: false, reason: "stale" };

  const row = await getMember(store, token, userId);
  if (!row) return { ok: false, reason: "not_member" };
  // Signed by the wallet the post is shown under, so the record says who wrote it and nothing more.
  const signer = getAddress(row.displayWallet);
  if (!(await (deps.verifyPost ?? viemVerifyPost)(signer, message, signature as Hex))) return { ok: false, reason: "bad_signature" };

  const existing = await getPost(store, token, postId(message));
  if (existing) {
    if (existing.userId !== userId) return { ok: false, reason: "wrong_signer" };
    return { ok: true, post: viewPost(existing, { userId, staff: isStaff(await roleIn(store, token, userId, deps)) }, false) };
  }
  return createPost(store, entry, userId, { kind: message.kind, text: message.text, link: message.link || undefined, signed: { message, signature: signature as Hex } }, deps);
}

/**
 * A stored signed post as the export serves it: the exact message and signature. Posts hidden by
 * moderation are left out, so the export can't carry what reports or a moderator took down;
 * restoring a post brings it back.
 */
function toSigned(token: string, post: StoredPost): SignedPost | null {
  if (!post.signed || post.hidden) return null;
  return {
    id: post.id,
    signer: getAddress(post.wallet),
    message: { club: getAddress(token), kind: post.kind, text: post.text, link: linkString(post.link), at: post.signed.at },
    signature: post.signed.signature,
  };
}

/** A Club's signed posts, newest first, for the public export. Hidden posts are left out. */
export async function exportPosts(store: Store, entry: AssetEntry, limit = POSTS_KEPT): Promise<SignedPost[]> {
  const token = entry.address.toLowerCase();
  const ids = await store.ranked(postsKey(token), limit);
  const rows = await store.getMany<StoredPost>(ids.map((id) => postKey(token, id)));
  return rows.flatMap((row) => {
    const signed = row ? toSigned(token, row) : null;
    return signed ? [signed] : [];
  });
}

/** Every signed post `wallet` wrote, across Clubs, newest first. */
export async function walletPosts(store: Store, wallet: string, limit = POSTS_KEPT): Promise<SignedPost[]> {
  const refs = await store.ranked(walletPostsKey(wallet), limit);
  const rows = await store.getMany<StoredPost>(refs.map((ref) => {
    const [token, id] = ref.split(":");
    return postKey(token!, id!);
  }));
  return rows.flatMap((row, i) => {
    const signed = row ? toSigned(refs[i]!.split(":")[0]!, row) : null;
    return signed ? [signed] : [];
  });
}

// Unsigned posts have a random 32-hex id; signed ones their 64-hex struct hash.
const getPost = (store: Store, token: string, id: string) =>
  /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(id) ? store.get<StoredPost>(postKey(token, id)) : Promise.resolve(null);

/**
 * The Club's posts as `viewer` sees them: pinned first, then newest first. Hidden posts show only
 * a placeholder, except to their author and to staff, who also see how many reports each has.
 */
export async function listPosts(
  store: Store,
  entry: AssetEntry,
  viewer: { userId?: string; lens?: LensId; as?: string },
  deps: Deps = {},
): Promise<{ posts: PublicPost[]; role: ClubRole | null }> {
  const token = entry.address.toLowerCase();
  const role = viewer.userId ? await roleIn(store, token, viewer.userId, deps) : null;
  const staff = role !== null && isStaff(role);
  const profile = await loadProfile(store, token);

  // A post may have been deleted without leaving the ranking, so read a few more than are shown.
  const ids = await store.ranked(postsKey(token), POSTS_SHOWN + 50);
  const wanted = [...new Set([...profile.pinned, ...ids])];
  const rows = await store.getMany<StoredPost>(wanted.map((id) => postKey(token, id)));
  const live = new Map(rows.flatMap((row) => (row ? [[row.id, row] as const] : [])));
  const recent = ids.flatMap((id) => (live.has(id) ? [live.get(id)!] : [])).slice(0, POSTS_SHOWN);
  // Reports may hide a pinned post without unpinning it (so a restore puts it back). Until then it
  // isn't shown as pinned, except to staff, who need to see what they'd be restoring.
  const pinned = staff ? profile.pinned : profile.pinned.filter((id) => !live.get(id)?.hidden);
  // The reader's lens orders the rest (ADR 0023). Pins stay on top whatever it filters, unless the
  // lens drops them: an Owner's pin is the Club speaking.
  const lens = lensOf(viewer.lens);
  const ranked = lens.rank(recent.filter((p) => !lens.pins || !pinned.includes(p.id)), await lensContext(store, entry, lens.id, viewer.as, deps));
  const pinnedPosts = lens.pins ? pinned.flatMap((id) => (live.has(id) ? [live.get(id)!] : [])) : [];
  const ordered = pinnedFirst([...pinnedPosts, ...ranked], lens.pins ? pinned : []);

  // Staff see the report count of every reported post, hidden or not: reports that don't count
  // toward hiding (from members who aren't Holders) still reach them for review.
  const counts = new Map<string, number>();
  if (staff) {
    await Promise.all(
      ordered.filter((p) => p.hidden || p.reported).map(async (p) => counts.set(p.id, await store.countMembers(reportsKey(token, p.id)))),
    );
  }
  return { posts: ordered.map((p) => viewPost(p, { userId: viewer.userId, staff }, pinned.includes(p.id), counts.get(p.id))), role };
}

/** What a lens needs, read only when it needs it. */
async function lensContext(store: Store, entry: AssetEntry, lens: LensId, as: string | undefined, deps: Deps): Promise<LensContext> {
  const now = nowOf(deps);
  const ctx = { now, follows: new Set<string>(), holders: new Set<string>(), momentum: new Map<string, number>() };
  if (lens === "following" && as) ctx.follows = await followingOf(store, as);
  if (lens === "holders" || lens === "momentum") {
    const rows = await allRows(store, entry.address.toLowerCase());
    for (const row of rows) if (row.holder && row.displayWallet) ctx.holders.add(row.displayWallet.toLowerCase());
    if (lens === "momentum") {
      const scores = score((await clubEvents(store, entry as ClubEntry)).map(toScored), Math.floor(now / 1000));
      for (const row of rows) if (row.displayWallet) ctx.momentum.set(row.displayWallet.toLowerCase(), memberScore(scores, row.wallets));
    }
  }
  return ctx;
}

export type Refusal = "archived" | "not_member" | "banned" | "not_found" | "forbidden" | "own_post" | "rate_limited" | "too_many_pinned" | "hidden";

/** Author, or staff who may act on the author's role. */
export async function deletePost(store: Store, entry: AssetEntry, actor: Actor, id: string, deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: Refusal }> {
  const token = entry.address.toLowerCase();
  const post = await getPost(store, token, id);
  if (!post) return { ok: false, reason: "not_found" };
  const own = post.userId === actor.userId;
  if (!own) {
    const roles = await loadRoles(store, token);
    const mine = roleOf(roles, actor.userId, isAdmin(deps, actor.userId));
    if (!mayActOn(mine, roleOf(roles, post.userId, isAdmin(deps, post.userId)))) return { ok: false, reason: "forbidden" };
  }
  await store.del(postKey(token, id), reportsKey(token, id), countedReportsKey(token, id));
  await unpin(store, token, id);
  if (!own) await log(store, entry, actor, "delete_post", id);
  return { ok: true };
}

/**
 * A member's report. Every report is kept and shown to staff, but only those from Holders and staff
 * count toward hiding: at `REPORTS_TO_HIDE` of those the post is hidden. Joining a Club is free, so
 * otherwise a handful of throwaway accounts could hide any post. A post by staff (Owner, Moderator
 * or app admin) is never hidden by reports: only someone who outranks its author may hide it.
 *
 * A hidden post stays pinned (it isn't shown as pinned while hidden), so a restore puts it back.
 */
export async function reportPost(
  store: Store,
  entry: AssetEntry,
  userId: string,
  id: string,
  deps: Deps = {},
): Promise<{ ok: true; hidden: boolean } | { ok: false; reason: Refusal }> {
  const token = entry.address.toLowerCase();
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const row = await getMember(store, token, userId);
  if (!row) return { ok: false, reason: "not_member" };
  if (await isBanned(store, token, userId)) return { ok: false, reason: "banned" };
  const post = await getPost(store, token, id);
  if (!post) return { ok: false, reason: "not_found" };
  if (post.userId === userId) return { ok: false, reason: "own_post" };
  if (!(await withinLimit(store, "club-report", userId, REPORTS_PER_DAY, 86_400))) return { ok: false, reason: "rate_limited" };

  const roles = await loadRoles(store, token);
  const reporterStaff = isStaff(roleOf(roles, userId, isAdmin(deps, userId)));
  const authorStaff = isStaff(roleOf(roles, post.userId, isAdmin(deps, post.userId)));

  await store.addMember(reportsKey(token, id), userId);
  if (row.holder || reporterStaff) await store.addMember(countedReportsKey(token, id), userId);
  const counted = await store.countMembers(countedReportsKey(token, id));
  if (counted >= REPORTS_TO_HIDE && !post.hidden && !authorStaff) {
    await store.set(postKey(token, id), { ...post, reported: true, hidden: "reports" } satisfies StoredPost);
    await appendLog(store, token, { actor: "reports", action: "auto_hide", target: id, detail: `${counted} reports` }, nowOf(deps));
    return { ok: true, hidden: true };
  }
  if (!post.reported) await store.set(postKey(token, id), { ...post, reported: true } satisfies StoredPost);
  return { ok: true, hidden: !!post.hidden };
}

/** Takes a post off the pinned list. */
async function unpin(store: Store, token: string, id: string): Promise<void> {
  const profile = await loadProfile(store, token);
  if (profile.pinned.includes(id)) await saveProfile(store, token, { ...profile, pinned: profile.pinned.filter((p) => p !== id) });
}

/** Staff hide a post, or restore a hidden one (which also clears its reports). */
export async function hidePost(store: Store, entry: AssetEntry, actor: Actor, id: string, hide: boolean, deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: Refusal }> {
  const token = entry.address.toLowerCase();
  const roles = await loadRoles(store, token);
  const mine = roleOf(roles, actor.userId, isAdmin(deps, actor.userId));
  if (!isStaff(mine)) return { ok: false, reason: "forbidden" };
  const post = await getPost(store, token, id);
  if (!post) return { ok: false, reason: "not_found" };
  if (!mayActOn(mine, roleOf(roles, post.userId, isAdmin(deps, post.userId)))) return { ok: false, reason: "forbidden" };

  if (hide) {
    // A deliberate hide by staff also unpins; a hide by reports doesn't (see `reportPost`).
    await store.set(postKey(token, id), { ...post, hidden: "moderator" } satisfies StoredPost);
    await unpin(store, token, id);
  } else {
    const visible: StoredPost = { ...post };
    delete visible.hidden;
    delete visible.reported;
    await store.set(postKey(token, id), visible);
    await store.del(reportsKey(token, id), countedReportsKey(token, id));
  }
  await log(store, entry, actor, hide ? "hide_post" : "restore_post", id);
  return { ok: true };
}

/** The Owner (or an admin) pins up to `MAX_PINNED` posts; a hidden post can't be pinned. */
export async function pinPost(store: Store, entry: AssetEntry, actor: Actor, id: string, pin: boolean, deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: Refusal }> {
  const token = entry.address.toLowerCase();
  if (!isOwnerOrAdmin(await roleIn(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  const profile = await loadProfile(store, token);
  if (pin) {
    const post = await getPost(store, token, id);
    if (!post) return { ok: false, reason: "not_found" };
    if (post.hidden) return { ok: false, reason: "hidden" };
    if (!profile.pinned.includes(id)) {
      if (profile.pinned.length >= MAX_PINNED) return { ok: false, reason: "too_many_pinned" };
      await saveProfile(store, token, { ...profile, pinned: [...profile.pinned, id] });
    }
  } else {
    await saveProfile(store, token, { ...profile, pinned: profile.pinned.filter((p) => p !== id) });
  }
  await log(store, entry, actor, pin ? "pin_post" : "unpin_post", id);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Bans

/**
 * The member whose Club wallet (the one shown on the board and in the member list) is `wallet`.
 * Their other linked wallets don't match: staff name members by what the Club shows, and matching
 * a wallet the member never showed would tell staff who owns it.
 */
async function memberByWallet(store: Store, token: string, wallet: string) {
  const w = wallet.toLowerCase();
  return (await allRows(store, token)).find((row) => row.displayWallet === w) ?? null;
}

export type BanTarget = { wallet?: unknown; post?: unknown };

/**
 * Bans a member (named by wallet) or a post's author (so a spammer who already left is still
 * reached). The banned user leaves the Club and loses any role; `everywhere` is for app admins.
 */
export async function banUser(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  target: BanTarget,
  everywhere: boolean,
  deps: Deps = {},
): Promise<{ ok: true; wallet: string } | { ok: false; reason: Refusal }> {
  const token = entry.address.toLowerCase();
  const roles = await loadRoles(store, token);
  const mine = roleOf(roles, actor.userId, isAdmin(deps, actor.userId));
  if (!isStaff(mine)) return { ok: false, reason: "forbidden" };
  if (everywhere && mine !== "admin") return { ok: false, reason: "forbidden" };

  let userId: string | undefined;
  let wallet: string | undefined;
  if (typeof target.post === "string") {
    const post = await getPost(store, token, target.post);
    userId = post?.userId;
    wallet = post?.wallet;
  } else if (typeof target.wallet === "string") {
    const row = await memberByWallet(store, token, target.wallet);
    userId = row?.userId;
    wallet = row?.displayWallet;
  }
  if (!userId || !wallet) return { ok: false, reason: "not_found" };
  if (userId === actor.userId) return { ok: false, reason: "forbidden" };
  if (!mayActOn(mine, roleOf(roles, userId, isAdmin(deps, userId)))) return { ok: false, reason: "forbidden" };

  const scope = everywhere ? ALL : token;
  const bans = await loadBans(store, scope);
  await saveBans(store, scope, { ...bans, [userId]: { wallet, at: nowOf(deps), by: actor.wallet, role: mine } satisfies Ban });
  if (everywhere) {
    await Promise.all((await store.members(userClubsKey(userId))).map((t) => leaveClub(store, t, userId)));
  } else {
    await leaveClub(store, token, userId);
  }
  await log(store, entry, actor, everywhere ? "ban_everywhere" : "ban", wallet);
  return { ok: true, wallet };
}

/**
 * Lifts a ban made in this Club, or (admins) everywhere. It doesn't put the user back in. Only
 * someone of at least the banner's rank may lift it.
 */
export async function unbanUser(store: Store, entry: AssetEntry, actor: Actor, wallet: string, everywhere: boolean, deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: Refusal }> {
  const token = entry.address.toLowerCase();
  const mine = await roleIn(store, token, actor.userId, deps);
  if (!isStaff(mine) || (everywhere && mine !== "admin")) return { ok: false, reason: "forbidden" };
  const scope = everywhere ? ALL : token;
  const bans = await loadBans(store, scope);
  const found = Object.entries(bans).find(([, ban]) => ban.wallet === wallet.toLowerCase());
  if (!found) return { ok: false, reason: "not_found" };
  if (!atLeast(mine, banRole(found[1]))) return { ok: false, reason: "forbidden" };
  const rest = { ...bans };
  delete rest[found[0]];
  await saveBans(store, scope, rest);
  await log(store, entry, actor, everywhere ? "unban_everywhere" : "unban", found[1].wallet);
  return { ok: true };
}

/** The wallets banned from this Club (and, for admins, everywhere). Staff only. */
export async function listBans(store: Store, entry: AssetEntry, userId: string, deps: Deps = {}): Promise<{ club: Ban[]; everywhere: Ban[] } | null> {
  const token = entry.address.toLowerCase();
  const mine = await roleIn(store, token, userId, deps);
  if (!isStaff(mine)) return null;
  const club = Object.values(await loadBans(store, token));
  return { club, everywhere: mine === "admin" ? Object.values(await loadBans(store, ALL)) : [] };
}

// ---------------------------------------------------------------------------------------------
// Roles, the Owner's claim and the Club profile

const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);
let cached: PublicClient | undefined;

/** The token contract's `owner()`, or `null` when it has none (or the read fails). */
export async function readOwner(token: Address): Promise<string | null> {
  try {
    cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;
    return (await cached.readContract({ address: token, abi: OWNER_ABI, functionName: "owner" })).toLowerCase();
  } catch {
    return null;
  }
}

export type ClaimResult = { ok: true } | { ok: false; reason: "not_member" | "no_owner" | "not_owner" | "has_owner" };

/**
 * A member whose linked wallet is the contract's `owner()` becomes the Club's Owner. It is checked
 * once, now: if `owner()` changes later an admin sees it (`ownershipCheck`) and decides.
 */
export async function claimOwner(store: Store, entry: AssetEntry, actor: Actor, wallets: readonly string[], deps: Deps = {}): Promise<ClaimResult> {
  const token = entry.address.toLowerCase();
  if (!(await getMember(store, token, actor.userId))) return { ok: false, reason: "not_member" };
  const owner = await (deps.ownerOf ?? readOwner)(entry.address);
  if (!owner) return { ok: false, reason: "no_owner" };
  if (!wallets.some((w) => w.toLowerCase() === owner)) return { ok: false, reason: "not_owner" };

  const roles = await loadRoles(store, token);
  if (roles.owner === actor.userId) return { ok: true };
  if (roles.owner) return { ok: false, reason: "has_owner" };
  await saveRoles(store, token, { owner: actor.userId, moderators: roles.moderators.filter((id) => id !== actor.userId) });
  const profile = await loadProfile(store, token);
  await saveProfile(store, token, { ...profile, ownerClaim: { wallet: owner, at: nowOf(deps) } });
  await log(store, entry, { ...actor, wallet: owner }, "claim_owner", owner);
  return { ok: true };
}

/** Whether the on-chain owner still is the wallet that claimed the Club. For admins. */
export async function ownershipCheck(store: Store, entry: AssetEntry, deps: Deps = {}): Promise<{ claimed: string; onchain: string | null; changed: boolean } | null> {
  const claim = (await loadProfile(store, entry.address)).ownerClaim;
  if (!claim) return null;
  const onchain = await (deps.ownerOf ?? readOwner)(entry.address);
  return { claimed: claim.wallet, onchain, changed: onchain !== claim.wallet };
}

export type RoleRefusal = "forbidden" | "not_found" | "too_many_moderators" | "already_owner" | "no_change";

/** Appoint or remove a Moderator, or hand over (or assign, for admins) the Owner role. */
export async function setRole(store: Store, entry: AssetEntry, actor: Actor, wallet: string, role: RoleChange["role"], deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: RoleRefusal }> {
  const token = entry.address.toLowerCase();
  const roles = await loadRoles(store, token);
  const mine = roleOf(roles, actor.userId, isAdmin(deps, actor.userId));
  if (!isOwnerOrAdmin(mine)) return { ok: false, reason: "forbidden" };
  const target = await memberByWallet(store, token, wallet);
  if (!target) return { ok: false, reason: "not_found" };
  const result = applyRole(roles, mine, { userId: target.userId, role }, isAdmin(deps, target.userId));
  if (!result.ok) return result;
  await saveRoles(store, token, result.roles);
  await log(store, entry, actor, result.action, target.displayWallet);
  return { ok: true };
}

export async function updateProfile(store: Store, entry: AssetEntry, actor: Actor, input: unknown, deps: Deps = {}): Promise<{ ok: true; profile: ClubProfile } | { ok: false; reason: "forbidden" | "archived" | "invalid"; message?: string }> {
  const token = entry.address.toLowerCase();
  if (!isOwnerOrAdmin(await roleIn(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const checked = checkProfileEdit(input);
  if (!checked.ok) return { ok: false, reason: "invalid", message: checked.reason };
  const profile = { ...(await loadProfile(store, token)), ...checked.edit };
  await saveProfile(store, token, profile);
  await log(store, entry, actor, "edit_profile", undefined, Object.keys(checked.edit).join(", "));
  return { ok: true, profile };
}

// ---------------------------------------------------------------------------------------------
// Admin

/** What a Club had stored, and what a purge removed. */
export type PurgeCounts = { members: number; posts: number };

/**
 * Deletes everything stored for a Club: members (and their entry in "your Clubs"), posts, roles,
 * profile, bans of that Club, the log and the activity log. For hidden Clubs, admin only; nothing
 * calls it by itself.
 */
export async function purgeClub(store: Store, token: string): Promise<PurgeCounts> {
  const lower = token.toLowerCase();
  const ids = await store.members(membersKey(lower));
  await Promise.all(ids.map((id) => store.removeMember(userClubsKey(id), lower)));
  await store.del(...ids.map((id) => memberKey(lower, id)), membersKey(lower));

  const postIds = await store.ranked(postsKey(lower), POSTS_KEPT);
  await store.del(...postIds.flatMap((id) => [postKey(lower, id), reportsKey(lower, id), countedReportsKey(lower, id)]), postsKey(lower));
  await store.del(rolesKey(lower), clubProfileKey(lower), banKey(lower), logKey(lower), activityKey(lower));
  return { members: ids.length, posts: postIds.length };
}
