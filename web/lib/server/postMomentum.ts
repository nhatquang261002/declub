import type { StoredPost } from "../clubPosts";
import type { ActivityEvent } from "../clubs";
import { CHAIN_ID } from "../config";
import { dayOf } from "./activeDays";
import { postKey } from "./board";
import type { Store } from "./store";

/**
 * Board posts in Momentum (ADR 0047): a Holder's top-level post counts once a day per Club. Posts
 * are recorded when they're written; reading checks each is still there and not hidden, so a
 * deleted or hidden post counts for nothing and the member's next post that day takes its place.
 */
export const momentumPostsKey = (club: string) => `declub:momentum-posts:${CHAIN_ID}:${club.toLowerCase()}`;

/** Posts recorded per member per day: a spare or two, so deleting one post doesn't lose the day. */
const RECORDED_PER_DAY = 3;
/** Posts kept per Club. A busy Club fills this in weeks, and Momentum reads 30 days. */
const KEPT = 5_000;

/** Records a Holder's top-level post toward Momentum. `at` is epoch ms, as posts keep it. */
export async function recordMomentumPost(store: Store, club: string, post: { id: string; userId: string; at: number }): Promise<void> {
  const seconds = Math.floor(post.at / 1000);
  if ((await store.hit(`momentum-post-day:${club.toLowerCase()}:${dayOf(seconds)}:${post.userId}`, 2 * 86_400)) > RECORDED_PER_DAY) return;
  await store.rank(momentumPostsKey(club), [{ member: post.id, score: seconds }], KEPT);
}

/** The Club's counted Board posts as activity events, for Momentum (`lib/server/clubs.ts`). */
export async function momentumPostEvents(store: Store, club: string): Promise<ActivityEvent[]> {
  const token = club.toLowerCase();
  const ids = await store.ranked(momentumPostsKey(token), KEPT);
  const posts = await store.getMany<StoredPost>(ids.map((id) => postKey(token, id)));
  const counted = new Set<string>();
  const events: ActivityEvent[] = [];
  // Oldest first, so a member's first post still shown that day is the one that counts.
  for (const post of posts.reverse()) {
    if (!post || post.hidden || post.parent) continue;
    const at = Math.floor(post.at / 1000);
    const day = `${post.userId}:${dayOf(at)}`;
    if (counted.has(day)) continue;
    counted.add(day);
    events.push({ id: `post:${post.id}`, kind: "post", contract: "", deal: post.id, block: 0, at, parties: [post.wallet.toLowerCase()], tokens: [token] });
  }
  return events;
}
