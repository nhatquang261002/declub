import type { PublicPost } from "./clubPosts";
import { SYSTEM_GROUP_SHOWN } from "./systemFeed";

/**
 * The timeline (ADR 0041): posts from many Clubs' Boards in one list. `joined` is the Clubs the
 * reader belongs to; `all` is every live Club and the reader's own archived ones, which is what the
 * page shows unless the reader filters to their Clubs; `others` is every live Club they haven't joined.
 */
export type TimelineScope = "joined" | "all" | "others";

/** A Board post as the timeline shows it: the post, and the Club (lowercase token) it was made in. */
export type TimelinePost = PublicPost & { club: string };

/** Posts in the first page and in each page that loads as the list is scrolled. */
export const TIMELINE_PAGE = 20;
export const TIMELINE_MAX_PAGE = 50;

/**
 * Where a page stops: the post it ended on. The next page is everything after it in the list's
 * order (newest first, ties by id), so the list can go on as far as the Boards do (each keeps its
 * newest `POSTS_KEPT` posts), with nothing loaded before it's wanted and nothing shifting under a
 * reader when new posts arrive.
 */
export type TimelineCursor = { at: number; id: string };

export const formatCursor = (c: TimelineCursor) => `${c.at}:${c.id}`;

export function parseCursor(value: unknown): TimelineCursor | null {
  const m = typeof value === "string" ? /^(\d{1,16}):([0-9a-f]{32}|[0-9a-f]{64})$/.exec(value) : null;
  return m ? { at: Number(m[1]), id: m[2]! } : null;
}

/** Whether `a` comes before `b` in the list: newer first, and the lower id first among posts of the same moment. */
export const precedes = (a: TimelineCursor, b: TimelineCursor) => a.at > b.at || (a.at === b.at && a.id < b.id);

export const isScope = (value: unknown): value is TimelineScope => value === "joined" || value === "all" || value === "others";

/**
 * Splits `items` (newest first) over `count` columns for a masonry layout: each goes to the column
 * that is shortest so far, so there are no gaps under short cards, and an item's column depends only
 * on the ones before it, so loading more never moves what is already there. `height` is an estimate
 * (the real heights aren't known until the cards are drawn); ties go to the leftmost column.
 */
export function toColumns<T>(items: readonly T[], count: number, height: (item: T) => number): T[][] {
  const columns = Array.from({ length: Math.max(1, Math.floor(count)) }, () => ({ items: [] as T[], used: 0 }));
  for (const item of items) {
    const shortest = columns.reduce((a, b) => (b.used < a.used ? b : a));
    shortest.items.push(item);
    shortest.used += height(item);
  }
  return columns.map((column) => column.items);
}

/** About how tall a post's card is, in px: a cover and footer, the text by length, and what is attached. */
export function estimateHeight(post: Pick<TimelinePost, "text" | "link" | "x">): number {
  const text = Math.ceil((post.text?.length ?? 0) / 40) * 26;
  const attached = post.link?.kind === "x" ? 150 + Math.ceil((post.x?.text.length ?? 0) / 48) * 22 + (post.x?.image ? 240 : 0) : post.link ? 56 : 0;
  // 190: the cover, the author row, the footer and the card's padding and gaps.
  return 190 + text + attached;
}

/** About how tall a run of system messages is, in px (ADR 0043): a line each, up to the few shown, and the "more" link. */
export const systemHeight = (count: number) => 26 + Math.min(count, SYSTEM_GROUP_SHOWN) * 24 + (count > SYSTEM_GROUP_SHOWN ? 22 : 0);
