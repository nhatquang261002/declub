import type { ReachEntry, ReachRecord } from "../rewards";
import { epochWindow } from "../rewards";
import { matchSignals } from "../xPosts";
import { registry, type ClubEntry } from "../verifiedAssets";
import { loadProfile } from "./clubState";
import { reachKey } from "./rewards";
import type { Store } from "./store";
import { fetchXPosts, xApiConfigured, type XApiPost } from "./xApi";
import { privyXAccount, readXShares, signalsOf } from "./xPosts";

/**
 * The X reach behind the Holder bonus (ADR 0024), read once per epoch before it's built, so the
 * builder makes no network call while it holds its lock. For each X share made in the epoch it
 * reads the post from the X API and checks again what was checked when it was shared, now with the
 * API's own data: the author is still the member's X account (by X's numeric id, which a rename
 * doesn't change), and the post is still about the Club (with its full links, and who it quotes).
 * The result is saved and published with the epoch, so anyone can recompute the bonus.
 */
export type ReachDeps = {
  /** Unix seconds. */
  now?: () => number;
  clubs?: readonly ClubEntry[];
  genesis?: number;
  length?: number;
  /** The posts by id; X's API in production. Absent ids are deleted or private. */
  posts?: (ids: readonly string[]) => Promise<Map<string, XApiPost>>;
  /** Whether reach can be read at all (X_BEARER_TOKEN). */
  configured?: boolean;
  xAccountOf?: (userId: string) => Promise<{ username: string; subject: string } | null>;
};

export async function collectReach(store: Store, n: number, deps: ReachDeps = {}): Promise<ReachRecord> {
  const window = epochWindow(n, deps.genesis, deps.length);
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const configured = deps.configured ?? xApiConfigured();
  const record: ReachRecord = { n, collectedAt: now, available: configured, posts: {} };

  if (configured) {
    const clubs = deps.clubs ?? registry.clubs();
    const shares = (
      await Promise.all(clubs.map(async (club) => ({ club, shares: await readXShares(store, club.address) })))
    ).flatMap(({ club, shares }) => shares.filter((s) => s.at >= window.start && s.at < window.end).map((share) => ({ club, share })));

    const posts = await (deps.posts ?? ((ids) => fetchXPosts(ids)))(shares.map((s) => s.share.tweet));
    const accountOf = deps.xAccountOf ?? privyXAccount;
    const accounts = new Map<string, Promise<{ username: string; subject: string } | null>>();
    const signals = new Map<string, ReturnType<typeof signalsOf>>();

    for (const { club, share } of shares) {
      const key = club.address.toLowerCase();
      if (!signals.has(key)) signals.set(key, signalsOf(club, await loadProfile(store, key)));
      if (!accounts.has(share.userId)) accounts.set(share.userId, accountOf(share.userId).catch(() => null));

      const post = posts.get(share.tweet);
      const account = await accounts.get(share.userId)!;
      const entry = (ok: boolean, strength: ReachEntry["strength"], engagement: number, reason?: ReachEntry["reason"]): ReachEntry => ({
        club: key,
        wallet: share.wallet,
        ok,
        strength,
        engagement,
        ...(reason ? { reason } : {}),
      });
      if (!post) record.posts[share.tweet] = entry(false, null, 0, "deleted");
      else if (!account) record.posts[share.tweet] = entry(false, null, 0, "no_account");
      else if (post.authorId !== account.subject) record.posts[share.tweet] = entry(false, null, 0, "not_author");
      else {
        const strength = matchSignals(signals.get(key)!, post.facts);
        record.posts[share.tweet] = strength ? entry(true, strength, post.engagement) : entry(false, null, 0, "no_signal");
      }
    }
  }

  await store.set(reachKey(n), record);
  return record;
}
