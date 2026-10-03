/**
 * Club posts (ADR 0016, docs/09-clubs.md): the first user-written text in the app, so the rules
 * are strict and live in one pure place. Posts are plain text: no HTML, markdown or links.
 */
export const POST_MAX = 280;
export const POSTS_PER_HOUR = 5;
export const POST_COOLDOWN_SEC = 30;
export const REPORTS_PER_DAY = 20;
/** This many distinct reports hide a post until a Moderator restores or deletes it. */
export const REPORTS_TO_HIDE = 3;
export const MAX_PINNED = 3;
/** How many posts a Club keeps. Older ones fall off the list. */
export const POSTS_KEPT = 500;
/** How many posts one read returns. */
export const POSTS_SHOWN = 100;

export type PostKind = "note" | "looking";
/** A deal or a signed swap a "Looking for" post points at. */
export type PostLink = { kind: "deal"; id: string } | { kind: "intent"; hash: string };
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
};

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
  /** Moderators only, on a reported post: how many members reported it. */
  reports?: number;
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

/** A deal id (digits) or an intent hash (0x and 64 hex digits), or `null` for anything else. */
export function parseLink(input: unknown): PostLink | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (/^\d{1,18}$/.test(value)) return { kind: "deal", id: String(BigInt(value)) };
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return { kind: "intent", hash: value.toLowerCase() };
  return null;
}

export function viewPost(
  post: StoredPost,
  viewer: { userId?: string; staff: boolean },
  pinned: boolean,
  reports?: number,
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
    hidden: post.hidden ?? null,
    pinned,
    mine,
    ...(viewer.staff && reports !== undefined ? { reports } : {}),
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
};

export const MAX_DESCRIPTION = 500;
export const MAX_LINKS = 3;
export const NO_PROFILE: ClubProfile = { description: "", links: [], holdersOnlyPosts: false, pinned: [] };

export type ProfileEdit = Partial<Pick<ClubProfile, "description" | "links" | "holdersOnlyPosts">>;
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
  return Object.keys(edit).length === 0 ? { ok: false, reason: "Nothing to change." } : { ok: true, edit };
}
