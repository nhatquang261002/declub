import type { StoredPost } from "../clubPosts";
import { viewPost } from "../clubPosts";
import { formatCursor, precedes, type TimelineCursor, type TimelinePost, type TimelineScope } from "../timeline";
import type { Registry } from "../verifiedAssets";
import { likedKey, likesKey, postKey, postsKey, repliesKey, walletPostsKey } from "./board";
import { clubsOf } from "./members";
import type { Store } from "./store";

/** Posts read past a page from each Club, so posts that are hidden or gone from the list don't leave a page short. */
const SPARE = 10;

/**
 * One page of posts from several Clubs' Boards as one list, newest first (ADR 0041), starting just
 * after `before` (the post the last page ended on). Nothing is capped: every page reads the next
 * slice of each Club's own ranking, so the list goes back as far as the Boards do, and a page costs
 * a read per Club however far down it is.
 *
 * Each Club is read a little past a page. A Club whose slice was full may hold more posts older
 * than the oldest it returned, so a post older than that is held back until the next page, which
 * keeps the merged order exact. `next` is where that page starts, or `null` at the end.
 *
 * Only what anyone may read is listed: hidden posts and replies are left out whoever asks, and
 * pins are ignored (a pin is the Club speaking on its own Board, not a reason to lead the timeline).
 * Archived Clubs are left out of `others` and `all` (a frozen Board has nothing new), but a reader's
 * own archived Club still shows under `joined` and `all`.
 */
export async function listTimeline(
  store: Store,
  registry: Registry,
  viewer: { userId?: string; scope: TimelineScope; before?: TimelineCursor; limit: number },
): Promise<{ posts: TimelinePost[]; next: string | null }> {
  // Who belongs where is the server's to say; the reader only names a scope.
  const joined = new Set(viewer.userId ? (await clubsOf(store, viewer.userId)).map((token) => token.toLowerCase()) : []);
  const tokens = registry
    .clubs()
    .filter((club) => {
      const mine = joined.has(club.address.toLowerCase());
      if (viewer.scope === "joined") return mine;
      if (viewer.scope === "others") return !mine && club.club !== "archived";
      return mine || club.club !== "archived";
    })
    .map((club) => club.address.toLowerCase());

  const fetched = viewer.limit + SPARE;
  const slices = await Promise.all(
    tokens.map(async (token) => {
      const ids = await store.rankedBefore(postsKey(token), viewer.before?.at ?? null, fetched);
      const rows = await store.getMany<StoredPost>(ids.map((id) => postKey(token, id)));
      // A post scored at the cursor's moment may be one the last page already showed.
      const after = rows.flatMap((row) => (row && (!viewer.before || precedes(viewer.before, row)) ? [{ token, post: row }] : []));
      // Where this Club's slice ended, if it was full: it may have older posts than this.
      const last = after.at(-1)?.post;
      return { after, edge: ids.length === fetched && last ? { at: last.at, id: last.id } : null };
    }),
  );

  // Past the newest of those edges, some Club may have posts this read didn't reach.
  const edges = slices.flatMap((slice) => (slice.edge ? [slice.edge] : []));
  const boundary = edges.reduce<TimelineCursor | null>((a, b) => (a === null || precedes(b, a) ? b : a), null);
  const eligible = slices
    .flatMap((slice) => slice.after)
    .filter(({ post }) => !post.hidden && !post.parent && (boundary === null || !precedes(boundary, post)))
    .sort((a, b) => b.post.at - a.post.at || (a.post.id < b.post.id ? -1 : 1));

  const page = eligible.slice(0, viewer.limit);
  // More to read: posts held back in this read, or Clubs that may have older ones. Even a page with
  // nothing in it (everything was hidden) moves on, to the edge.
  const next = eligible.length > viewer.limit ? page.at(-1)!.post : boundary;

  return { posts: await present(store, page, viewer.userId), next: next ? formatCursor(next) : null };
}

type Listed = { token: string; post: StoredPost };

/** Posts as `userId` (if any) sees them: with their like counts, reply counts and which ones the reader liked. */
async function present(store: Store, page: Listed[], userId: string | undefined): Promise<TimelinePost[]> {
  const liked = new Map<string, Set<string>>();
  if (userId) {
    await Promise.all([...new Set(page.map((p) => p.token))].map(async (token) => liked.set(token, new Set(await store.members(likedKey(token, userId))))));
  }
  const counts = await Promise.all(
    page.map(async ({ token, post }) => {
      const [likes, replies] = await Promise.all([store.countMembers(likesKey(token, post.id)), store.countMembers(repliesKey(token, post.id))]);
      return { likes, replies };
    }),
  );
  return page.map(({ token, post }, i) => ({
    ...viewPost(
      post,
      { userId, staff: false },
      false,
      undefined,
      { count: counts[i]!.likes, liked: liked.get(token)?.has(post.id) ?? false },
      counts[i]!.replies,
    ),
    club: token,
  }));
}

/**
 * One page of the posts a wallet wrote on the Boards, newest first, for its profile (ADR 0042), in
 * the same shape as the timeline and with the same rules: hidden posts and replies are left out
 * whoever asks, Clubs that have left the list are skipped, and `before` / `next` page the same way.
 * Signed and unsigned posts are both listed: they are what the Boards show everyone.
 */
export async function listWalletPosts(
  store: Store,
  registry: Registry,
  wallet: string,
  viewer: { userId?: string; before?: TimelineCursor; limit: number },
): Promise<{ posts: TimelinePost[]; next: string | null }> {
  const fetched = viewer.limit + SPARE;
  const refs = await store.rankedBefore(walletPostsKey(wallet), viewer.before?.at ?? null, fetched);
  const parsed = refs.flatMap((ref) => {
    const at = ref.indexOf(":");
    return at > 0 ? [{ token: ref.slice(0, at), id: ref.slice(at + 1) }] : [];
  });
  const rows = await store.getMany<StoredPost>(parsed.map((r) => postKey(r.token, r.id)));
  const read = parsed.flatMap((r, i) => (rows[i] ? [{ token: r.token, post: rows[i]! }] : []));
  // A post scored at the cursor's moment may be one the last page already showed.
  const after = read.filter(({ post }) => !viewer.before || precedes(viewer.before, post));
  const eligible = after
    .filter(({ token, post }) => !post.hidden && !post.parent && registry.clubFor(token))
    .sort((a, b) => b.post.at - a.post.at || (a.post.id < b.post.id ? -1 : 1));

  const page = eligible.slice(0, viewer.limit);
  // A full read may have older posts past its last one, so the next page starts there.
  const edge = refs.length === fetched && read.length > 0 ? { at: read.at(-1)!.post.at, id: read.at(-1)!.post.id } : null;
  const next = eligible.length > viewer.limit ? page.at(-1)!.post : edge;
  return { posts: await present(store, page, viewer.userId), next: next ? formatCursor(next) : null };
}
