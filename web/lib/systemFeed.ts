import type { ActivityEvent } from "./clubs";

/**
 * System messages (ADR 0043): the Club speaking on its Board and in the timeline, in a line between
 * posts. Each is something that happened and anyone can already see: a swap that completed, a deal
 * that was listed, a member who joined, a challenge the Owner started or that was won (ADR 0045). They are read from the activity log and the member list
 * when asked, never stored, and never signed or moderated, since nobody wrote them.
 */
export type SystemKind = "swap" | "listing" | "join" | "challenge" | "winner";

export type SystemEvent = {
  /** The activity event's id, `join:<club>:<wallet>`, or `challenge:<id>` / `challenge-won:<id>`. */
  id: string;
  /** Lowercase tokens of the Clubs it happened in: a deal naming two Clubs' assets is one event in both. */
  clubs: string[];
  kind: SystemKind;
  /** Unix seconds. */
  at: number;
  /** Lowercase wallets: both sides of a swap, the maker of a listing, the member who joined. */
  wallets: string[];
  /** The deal, for a swap or a listing: an escrow deal id, or for a signed swap its transaction hash. */
  deal?: string;
  /** A signed swap: `deal` is a transaction, not an escrow deal. */
  signed?: true;
  /** A challenge or a win (ADR 0045): its id, so the feed can draw the challenge itself (a card of its own, not a line). For "challenge" the wallet is the Owner's; for "winner", the winners', best first. */
  challenge?: string;
  /** The challenge's title, as the Owner wrote it (plain text). */
  title?: string;
};

/** How far back system messages go. */
export const SYSTEM_WINDOW_SEC = 7 * 86_400;
/** The most one read returns, newest first. */
export const SYSTEM_MAX = 40;

/** A challenge's start or result is drawn as a card of its own in a feed, never as a line in a run of messages (ADR 0045). */
const isChallengeEvent = (e: Pick<SystemEvent, "kind">) => e.kind === "challenge" || e.kind === "winner";

/**
 * The events without the starts of challenges pinned on top of the Board while they run: the card is
 * already there, so it isn't drawn twice. A result still shows; a challenge that is done falls back
 * into the feed at the time it started. `results` are settled challenges whose results the Owner
 * pinned (ADR 0050): neither their start nor their result is drawn again while they're pinned.
 */
export const withoutPinned = (events: readonly SystemEvent[], pinned: ReadonlySet<string>, results: ReadonlySet<string> = new Set()) =>
  events.filter((e) => !(e.challenge && ((e.kind === "challenge" && pinned.has(e.challenge)) || (isChallengeEvent(e) && results.has(e.challenge)))));

/** What `kind` of system message an activity event makes, or null for the kinds that make none (X shares are posts' business). */
export const systemKindOf = (e: Pick<ActivityEvent, "kind">): SystemKind | null => (e.kind === "swapped" ? "swap" : e.kind === "created" ? "listing" : null);

/**
 * The newest `max` of `events` inside the window ending at `now`, newest first, and `since`: the
 * moment from which the list is complete. When more happened than `max`, that is where the list
 * was cut, so a feed showing older posts knows not to draw a gap as if nothing happened in it.
 */
export function newest(events: readonly SystemEvent[], now: number, max = SYSTEM_MAX): { events: SystemEvent[]; since: number } {
  const floor = now - SYSTEM_WINDOW_SEC;
  const live = events.filter((e) => e.at > floor && e.at <= now).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (live.length <= max) return { events: live, since: floor };
  const kept = live.slice(0, max);
  return { events: kept, since: kept.at(-1)!.at };
}

/**
 * The same events read from several Clubs as one list: an event logged in each Club it names
 * (lib/server/activity.ts) comes once, with all of them.
 */
export function mergeClubs(events: readonly SystemEvent[]): SystemEvent[] {
  const byId = new Map<string, SystemEvent>();
  for (const e of events) {
    const seen = byId.get(e.id);
    if (seen) seen.clubs = [...new Set([...seen.clubs, ...e.clubs])];
    else byId.set(e.id, { ...e, clubs: [...e.clubs] });
  }
  return [...byId.values()];
}

/** How many lines of a run of system messages show before "more". */
export const SYSTEM_GROUP_SHOWN = 3;

/** One row of a feed: a post, or the run of system messages between two posts, newest first. */
export type FeedItem<P> = { type: "post"; post: P } | { type: "system"; events: SystemEvent[] } | { type: "challenge"; event: SystemEvent };

/**
 * Posts (as listed, `pinned` ones first and the rest newest first) with system messages set among
 * them by time. A message older than the oldest post loaded is held back while more posts are to
 * come (`complete` false), so it can't jump ahead of posts that haven't loaded; one older than
 * `since` is never drawn, since the list isn't complete that far back. Pinned posts stay on top,
 * and the messages between two posts come as one item. A challenge's start or result (ADR 0045) is
 * an item of its own, in its place by time, and splits a run.
 */
export function weave<P extends { at: number; pinned?: boolean }>(
  posts: readonly P[],
  events: readonly SystemEvent[],
  options: { since: number; complete: boolean },
): FeedItem<P>[] {
  // Posts' `at` is epoch ms; events' is unix seconds.
  const seconds = (p: P) => Math.floor(p.at / 1000);
  const pinned = posts.filter((p) => p.pinned);
  const rest = posts.filter((p) => !p.pinned);
  const floor = Math.max(options.since, options.complete || rest.length === 0 ? 0 : seconds(rest.at(-1)!));
  // With more posts to come and none loaded below the pins there is no floor to hold events to: show none.
  const held = !options.complete && rest.length === 0;
  const shown = held ? [] : events.filter((e) => e.at >= floor);

  const items: FeedItem<P>[] = pinned.map((post) => ({ type: "post", post }));
  const queue = [...shown].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
  // Messages between two posts go in one item, so a busy hour reads as one block, not a wall.
  const flush = (until: number) => {
    let run: SystemEvent[] = [];
    const close = () => {
      if (run.length > 0) items.push({ type: "system", events: run });
      run = [];
    };
    while (queue.length > 0 && queue[0]!.at > until) {
      const event = queue.shift()!;
      if (isChallengeEvent(event)) {
        close();
        items.push({ type: "challenge", event });
      } else run.push(event);
    }
    close();
  };
  for (const post of rest) {
    flush(seconds(post));
    items.push({ type: "post", post });
  }
  flush(Number.NEGATIVE_INFINITY);
  return items;
}
