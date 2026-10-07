import { MAX_X_TAGS, normalizeTag, parseXStatus, type SignalStrength, type XAccount, type XCard } from "./xPosts";

/**
 * Club posts (ADR 0016, docs/09-clubs.md): the first user-written text in the app, so the rules
 * are strict and live in one pure place. Posts are plain text, rendered as text and never as HTML or
 * markdown; control characters are stripped. A post may carry one link, kept apart from the text: a deal or signed swap on a "Looking
 * for" post, or an X post on a note (ADR 0024).
 */
export const POST_MAX = 280;
export const POSTS_PER_HOUR = 5;
export const POST_COOLDOWN_SEC = 30;
export const REPORTS_PER_DAY = 20;
export const MAX_PINNED = 3;
/** How many posts a Club keeps. Older ones fall off the list. */
export const POSTS_KEPT = 500;
/** A member likes at most this many posts an hour, so one account can't blanket a Club. */
export const LIKES_PER_HOUR = 120;
/** How many posts one read returns. */
export const POSTS_SHOWN = 100;
/** Replies (ADR 0032): one level deep, at most this many per post. */
export const REPLIES_KEPT = 50;
export const REPLIES_PER_HOUR = 20;
export const REPLY_COOLDOWN_SEC = 10;

export type PostKind = "note" | "looking";
/** A deal or a signed swap a "Looking for" post points at, or an X post a note shares. */
export type PostLink = { kind: "deal"; id: string } | { kind: "intent"; hash: string } | { kind: "x"; id: string };
export type HiddenBy = "reports" | "moderator";

/** What the server keeps. `userId` and the reports never leave the server. */
export type StoredPost = {
  id: string;
  userId: string;
  /** The author's display wallet when they posted. */
  wallet: string;
  kind: PostKind;
  text: string;
  link?: PostLink;
  /** Epoch ms. */
  at: number;
  hidden?: HiddenBy;
  /** Someone has reported it since it was posted or last restored (so staff are shown the count). */
  reported?: true;
  /**
   * The author's EIP-712 signature over the post (lib/social.ts), and the `at` they signed (unix
   * seconds). Every post made through the route is signed; the id is then the message's struct hash.
   */
  signed?: { signature: `0x${string}`; at: number };
  /** A shared X post's card, read when it was posted. Not part of what was signed. */
  x?: StoredXCard;
  /** On a reply: the top-level post it answers. Replies have no link and aren't on the Board list. */
  parent?: string;
};

/**
 * The card, plus whether the post is the author's own (their linked X account) and, if it counted
 * toward the Club's activity, how strongly it was about the Club.
 */
export type StoredXCard = XCard & { own: boolean; counted: SignalStrength | null };

/** A post as one viewer sees it. */
export type PublicPost = {
  id: string;
  wallet: string;
  kind: PostKind;
  at: number;
  /** `null` for a hidden post, unless the viewer wrote it or moderates the Club. */
  text: string | null;
  link?: PostLink;
  hidden: HiddenBy | null;
  pinned: boolean;
  mine: boolean;
  /** Members who liked it (0 for a hidden post), and whether the viewer is one. */
  likes: number;
  liked: boolean;
  /** Moderators only, on a reported post: how many members reported it. */
  reports?: number;
  /** The author signed it with their wallet, so it can be checked anywhere (the Club's feed export). */
  signed: boolean;
  /** A shared X post's card; hidden with the text. */
  x?: StoredXCard;
  /** How many replies a top-level post has; on a reply, the post it answers. */
  replies?: number;
  parent?: string;
};

// Control characters, line breaks, zero-width and bidirectional overrides: none belongs in a short
// post, and the last two can make one text read as another.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b\u202a-\u202e\u2066-\u2069\ufeff]+/g;

export type CleanText = { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" };

/** The text as it is stored: unsafe characters become spaces, runs of space collapse, ends trimmed. */
export function cleanText(input: unknown): CleanText {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  const text = input.replace(UNSAFE, " ").replace(/ {2,}/g, " ").trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  // Counted in characters, not UTF-16 units, so an emoji isn't two.
  if ([...text].length > POST_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}

/**
 * A deal id (digits), an intent hash (0x and 64 hex digits) or an X post link, or `null` for
 * anything else.
 */
export function parseLink(input: unknown): PostLink | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (/^\d{1,18}$/.test(value)) return { kind: "deal", id: String(BigInt(value)) };
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { kind: "intent", hash: value.toLowerCase() };
  const x = parseXStatus(value);
  return x ? { kind: "x", id: x } : null;
}

/** A note may share an X post; a "Looking for" post may point at a deal or a signed swap. */
export const linkFits = (kind: PostKind, link: PostLink) => (kind === "note" ? link.kind === "x" : link.kind !== "x");

/** The link `input` names, if it fits a post of `kind`; `null` otherwise. */
export function linkFor(kind: PostKind, input: unknown): PostLink | null {
  const link = parseLink(input);
  return link && linkFits(kind, link) ? link : null;
}

export function viewPost(
  post: StoredPost,
  viewer: { userId?: string; staff: boolean },
  pinned: boolean,
  reports?: number,
  likes: { count: number; liked: boolean } = { count: 0, liked: false },
  replies?: number,
): PublicPost {
  const mine = viewer.userId !== undefined && viewer.userId === post.userId;
  const seeText = !post.hidden || mine || viewer.staff;
  return {
    id: post.id,
    wallet: post.wallet,
    kind: post.kind,
    at: post.at,
    text: seeText ? post.text : null,
    ...(post.link && seeText ? { link: post.link } : {}),
    ...(post.x && seeText ? { x: post.x } : {}),
    hidden: post.hidden ?? null,
    pinned,
    mine,
    likes: post.hidden ? 0 : likes.count,
    liked: !post.hidden && likes.liked,
    signed: !!post.signed,
    ...(viewer.staff && reports !== undefined ? { reports } : {}),
    ...(post.parent ? { parent: post.parent } : replies !== undefined ? { replies } : {}),
  };
}

/** Pinned posts first (in the order they were pinned), then the rest as given (newest first). */
export function pinnedFirst<T extends { id: string }>(posts: readonly T[], pinned: readonly string[]): T[] {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const top = pinned.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const rest = posts.filter((p) => !pinned.includes(p.id));
  return [...top, ...rest];
}

/** What the Owner can set on the Club's page. */
export type ClubProfile = {
  description: string;
  /** https links, at most `MAX_LINKS`. */
  links: string[];
  holdersOnlyPosts: boolean;
  /** Post ids, in the order pinned. */
  pinned: string[];
  /** Who claimed ownership through `owner()`, so an admin can see if it later changes. */
  ownerClaim?: { wallet: string; at: number };
  /**
   * What makes an X post about this Club (ADR 0024): the project's accounts, linked by a proof
   * post (`lib/server/xPosts.ts`), and the Owner's tags.
   */
  x?: { accounts: XAccount[]; tags: string[] };
  /** Whether holding the Club's memecoin earns the Holder badge, set by the Owner (ADR 0026). */
  coinHolders?: CoinHolders;
};

/**
 * The Owner's rule for the Club's memecoin: `on` counts it toward the Holder badge, from `min` (base
 * units, a decimal string). `at` (epoch ms) is when it last changed, so older badges are re-checked.
 */
export type CoinHolders = { on: boolean; min: string; at: number };
/** A minimum as base units: a positive integer of at most 78 digits (a uint256). */
const MIN_UNITS = /^[1-9][0-9]{0,77}$/;

export const MAX_DESCRIPTION = 500;
export const MAX_LINKS = 3;
export const NO_PROFILE: ClubProfile = { description: "", links: [], holdersOnlyPosts: false, pinned: [] };

export type ProfileEdit = Partial<Pick<ClubProfile, "description" | "links" | "holdersOnlyPosts">> & {
  xTags?: string[];
  /** Without `min`, the current minimum stays. */
  coinHolders?: { on: boolean; min?: string };
};
export type ProfileResult = { ok: true; edit: ProfileEdit } | { ok: false; reason: string };

/** Checks an edit to the profile. Links must be plain `https://` addresses: they become anchors. */
export function checkProfileEdit(input: unknown): ProfileResult {
  if (typeof input !== "object" || input === null) return { ok: false, reason: "Send what to change." };
  const body = input as Record<string, unknown>;
  const edit: ProfileEdit = {};
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return { ok: false, reason: "The description must be text." };
    const text = body.description.replace(UNSAFE, " ").replace(/ {2,}/g, " ").trim();
    if ([...text].length > MAX_DESCRIPTION) return { ok: false, reason: `The description is at most ${MAX_DESCRIPTION} characters.` };
    edit.description = text;
  }
  if (body.links !== undefined) {
    if (!Array.isArray(body.links) || body.links.length > MAX_LINKS) return { ok: false, reason: `Give at most ${MAX_LINKS} links.` };
    const links: string[] = [];
    for (const raw of body.links) {
      let url: URL;
      try {
        url = new URL(typeof raw === "string" ? raw.trim() : "");
      } catch {
        return { ok: false, reason: "Links must be full https:// addresses." };
      }
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 200) {
        return { ok: false, reason: "Links must be plain https:// addresses of at most 200 characters." };
      }
      links.push(url.href);
    }
    edit.links = links;
  }
  if (body.holdersOnlyPosts !== undefined) {
    if (typeof body.holdersOnlyPosts !== "boolean") return { ok: false, reason: "holdersOnlyPosts is true or false." };
    edit.holdersOnlyPosts = body.holdersOnlyPosts;
  }
  if (body.xTags !== undefined) {
    if (!Array.isArray(body.xTags) || body.xTags.length > MAX_X_TAGS) return { ok: false, reason: `Give at most ${MAX_X_TAGS} tags.` };
    const tags: string[] = [];
    for (const raw of body.xTags) {
      const tag = normalizeTag(raw);
      if (!tag) return { ok: false, reason: "A tag is a #hashtag, a $cashtag or a word: 2 to 30 letters, digits or _." };
      if (!tags.includes(tag)) tags.push(tag);
    }
    edit.xTags = tags;
  }
  if (body.coinHolders !== undefined) {
    const coin = body.coinHolders as Record<string, unknown> | null;
    if (typeof coin !== "object" || coin === null || typeof coin.on !== "boolean") return { ok: false, reason: "coinHolders is { on, min }." };
    if (coin.min !== undefined && (typeof coin.min !== "string" || !MIN_UNITS.test(coin.min))) {
      return { ok: false, reason: "The minimum must be a whole number of base units above zero." };
    }
    edit.coinHolders = { on: coin.on, ...(coin.min !== undefined ? { min: coin.min as string } : {}) };
  }
  return Object.keys(edit).length === 0 ? { ok: false, reason: "Nothing to change." } : { ok: true, edit };
}
