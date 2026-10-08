import type { StoredPost } from "../clubPosts";
import { CHAIN_ID } from "../config";
import { epochAt } from "../rewards";
import { postKey } from "./board";
import type { Store } from "./store";

/**
 * Active days (ADR 0032, ADR 0038): a UTC day in an epoch with a visible top-level Board post by the
 * member in the Club, or a like or reply they gave there (recorded in ./backing.ts and passed in).
 * Each post is recorded when it's written, against the epoch it falls in; reading checks the post
 * is still there and not hidden, so a deleted or hidden post earns nothing. Streaks are in ./streaks.ts.
 */

/** The posts that can make a day active, as `userId:day:postId`. */
export const activeKey = (club: string, n: number) => `declub:active:${CHAIN_ID}:${club.toLowerCase()}:${n}`;

/** Posts recorded per member per day: a spare or two, so deleting one post doesn't lose the day. */
export const POSTS_PER_DAY_RECORDED = 3;

export const dayOf = (unixSeconds: number) => Math.floor(unixSeconds / 86_400);

/** Records a top-level post toward its author's active day. `at` is epoch ms, as posts keep it. */
export async function recordActive(store: Store, club: string, post: { id: string; userId: string; at: number }, genesis?: number, length?: number): Promise<void> {
  const seconds = Math.floor(post.at / 1000);
  const n = epochAt(seconds, genesis, length);
  if (n < 0) return;
  const day = dayOf(seconds);
  if ((await store.hit(`active-day:${club.toLowerCase()}:${day}:${post.userId}`, 2 * 86_400)) > POSTS_PER_DAY_RECORDED) return;
  await store.addMember(activeKey(club, n), `${post.userId}:${day}:${post.id}`);
}

/**
 * Each member's active days in a Club's epoch `n`, by user id, counting only posts still shown, and
 * the days in `also` (by user id: the days they liked or replied on).
 */
export async function activeDays(store: Store, club: string, n: number, also: ReadonlyMap<string, ReadonlySet<string>> = new Map()): Promise<Map<string, number>> {
  const entries = (await store.members(activeKey(club, n))).flatMap((m) => {
    // The user id is a Privy DID (`did:privy:…`), so it holds colons: read the day and post id off the right.
    const postAt = m.lastIndexOf(":");
    const dayAt = m.lastIndexOf(":", postAt - 1);
    return dayAt > 0 ? [{ userId: m.slice(0, dayAt), day: m.slice(dayAt + 1, postAt), id: m.slice(postAt + 1) }] : [];
  });
  const posts = await store.getMany<StoredPost>(entries.map(({ id }) => postKey(club, id)));
  const days = new Map<string, Set<string>>();
  entries.forEach(({ userId, day }, i) => {
    const post = posts[i];
    // A challenge entry earns through its challenge (ADR 0048): it doesn't make the day active.
    if (!post || post.hidden || post.parent || post.entry || post.userId !== userId) return;
    days.set(userId, (days.get(userId) ?? new Set()).add(day));
  });
  for (const [userId, more] of also) for (const day of more) days.set(userId, (days.get(userId) ?? new Set()).add(day));
  return new Map([...days].map(([userId, set]) => [userId, set.size]));
}
