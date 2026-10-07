import type { Address } from "viem";
import { formatMon } from "../format";
import { DEFAULT_CLUB_RULES, PROTOCOL, entryGap } from "../rewards";
import { registry as defaultRegistry, type ClubEntry, type Registry } from "../verifiedAssets";
import type { StoredPost } from "../clubPosts";
import { strengthFactor } from "../xPosts";
import { likesKey, postKey, repliesKey, walletPostsKey } from "./board";
import { loadProfile } from "./clubState";
import { userClubsKey } from "./members";
import { claimableFor } from "./rewards";
import { clubStandings, type ClubStandings } from "./standings";
import type { Store } from "./store";
import { readXShares } from "./xPosts";

/**
 * What a signed-in member should hear about the Clubs (not their deals; those come from the chain,
 * lib/notifications.ts). Like the deal notifications it is a pure read of current state: nothing is
 * pushed or stored here, so it can be recomputed on any device. The browser keeps which keys were
 * seen. A like's key carries the count, so the next like is news again.
 */
export type InboxItem = {
  key: string;
  kind: InboxKind;
  /** Epoch ms of the thing, for ordering. */
  at: number;
  title: string;
  body: string;
  href: string;
};

export type InboxKind = "club-like" | "club-pinned" | "club-reward" | "club-reply" | "club-xshare" | "club-rank" | "club-closing";

/** Posts older than this don't send news about likes or pins. */
export const INBOX_DAYS = 14;
/** At most this many of a member's recent posts are looked at. */
const POSTS_LOOKED_AT = 60;

/** The standings are read for at most this many of a member's Clubs. */
export const STANDINGS_CLUBS = 5;
/** The last stretch of an epoch, when a nudge to post is worth sending. */
export const CLOSING_SEC = 86_400;

export type InboxDeps = { now?: () => number; registry?: Registry; standings?: (store: Store, club: ClubEntry) => Promise<ClubStandings | null> };

export async function clubInbox(store: Store, userId: string, wallets: readonly string[], deps: InboxDeps = {}): Promise<InboxItem[]> {
  const nowMs = deps.now?.() ?? Date.now();
  const registry = deps.registry ?? defaultRegistry;
  const since = nowMs - INBOX_DAYS * 86_400_000;
  const out: InboxItem[] = [];
  const nameOf = (token: string) => registry.clubFor(token)?.name ?? "your Club";
  const clubHref = (token: string, tab?: string) => `/clubs/${token}${tab ? `?tab=${tab}` : ""}`;

  // The member's own recent posts, across their wallets.
  const refs = [...new Set((await Promise.all(wallets.map((w) => store.ranked(walletPostsKey(w), POSTS_LOOKED_AT)))).flat())].slice(0, POSTS_LOOKED_AT);
  const rows = await store.getMany<StoredPost>(refs.map((ref) => postKey(ref.split(":")[0]!, ref.split(":")[1]!)));
  const posts = rows.flatMap((post, i) => (post && post.userId === userId && !post.hidden && post.at >= since ? [{ post, token: refs[i]!.split(":")[0]! }] : []));

  const pinnedBy = new Map<string, Set<string>>();
  for (const token of new Set(posts.map((p) => p.token))) pinnedBy.set(token, new Set((await loadProfile(store, token)).pinned));

  await Promise.all(
    posts.map(async ({ post, token }) => {
      const likes = await store.countMembers(likesKey(token, post.id));
      const preview = post.text.length > 60 ? `${post.text.slice(0, 57)}…` : post.text;
      if (likes > 0) {
        out.push({
          key: `club-like:${token}:${post.id}:${likes}`,
          kind: "club-like",
          at: post.at,
          title: likes === 1 ? `Someone liked your post in ${nameOf(token)}` : `${likes} members liked your post in ${nameOf(token)}`,
          body: `“${preview}”`,
          href: clubHref(token, "board"),
        });
      }
      if (!post.parent) {
        const replyIds = await store.members(repliesKey(token, post.id));
        const others = (await store.getMany<StoredPost>(replyIds.map((id) => postKey(token, id)))).filter((r) => r && r.userId !== userId && !r.hidden).length;
        if (others > 0) {
          out.push({
            key: `club-reply:${token}:${post.id}:${others}`,
            kind: "club-reply",
            at: post.at,
            title: others === 1 ? `A reply to your post in ${nameOf(token)}` : `${others} replies to your post in ${nameOf(token)}`,
            body: `“${preview}”`,
            href: clubHref(token, "board"),
          });
        }
      }
      if (pinnedBy.get(token)?.has(post.id)) {
        out.push({
          key: `club-pinned:${token}:${post.id}`,
          kind: "club-pinned",
          at: post.at,
          title: `Your post is pinned in ${nameOf(token)}`,
          body: `“${preview}”`,
          href: clubHref(token, "board"),
        });
      }
    }),
  );

  // Rewards earned in the latest epochs. Whether one was claimed is read on chain by the Rewards
  // screens; here it is news that it was earned.
  for (const wallet of wallets) {
    for (const leaf of await claimableFor(store, wallet as Address, 3)) {
      out.push({
        key: `club-reward:${leaf.epoch}:${leaf.account.toLowerCase()}`,
        kind: "club-reward",
        at: nowMs,
        title: `You earned ${formatMon(BigInt(leaf.amount))} from epoch ${leaf.epoch}`,
        body: "Club Rewards from swap fees. Claim them from the Rewards tab or your Account settings.",
        href: "/settings",
      });
    }
  }
  // The member's Clubs: X posts that counted, and where they stand in the running epoch.
  const clubs = (await store.members(userClubsKey(userId))).flatMap((t) => {
    const entry = registry.clubFor(t);
    return entry ? [entry] : [];
  });
  const own = new Set(wallets.map((w) => w.toLowerCase()));
  for (const club of clubs) {
    const token = club.address.toLowerCase();
    for (const share of await readXShares(store, token, 50)) {
      if (share.userId !== userId || share.hidden || share.at * 1000 < since) continue;
      out.push({
        key: `club-xshare:${token}:${share.tweet}`,
        kind: "club-xshare",
        at: share.at * 1000,
        title: `Your X post counted in ${club.name}`,
        body: `+${PROTOCOL.xShareBase * strengthFactor(share.strength)} points toward your Holder bonus this epoch.`,
        href: clubHref(token, "rewards"),
      });
    }
  }
  const readStandings = deps.standings ?? ((s: Store, c: ClubEntry) => clubStandings(s, c));
  for (const club of clubs.slice(0, STANDINGS_CLUBS)) {
    const standings = await readStandings(store, club).catch(() => null);
    if (standings) out.push(...standingsNews(standings, club.name, own, nowMs));
  }
  return out.sort((a, b) => b.at - a.at);
}


/**
 * Where a member stands in a Club's running epoch, as news: their place in (or out of) the paid
 * Holders, which is new news each time it changes, and a nudge to post in the epoch's last day.
 */
export function standingsNews(s: ClubStandings, name: string, wallets: ReadonlySet<string>, nowMs: number): InboxItem[] {
  const out: InboxItem[] = [];
  const href = `/clubs/${s.club}?tab=rewards`;
  const rules = s.rules ?? DEFAULT_CLUB_RULES;
  const row = s.rows.find((r) => wallets.has(r.wallet));
  if (row && BigInt(s.holderPool) > 0n) {
    const paid = row.estimate !== undefined;
    const gap = entryGap(s.rows.map((r) => ({ wallet: r.wallet, shares: BigInt(r.shares), points: r.points, joinedAt: r.joinedAt })), row.wallet, rules) ?? 0;
    out.push({
      key: `club-rank:${s.club}:${s.n}:${paid ? "in" : "out"}`,
      kind: "club-rank",
      at: s.computedAt * 1000,
      title: paid ? `You’re #${row.rank} in ${name} this epoch` : row.points > 0 ? `You’re #${row.rank} in ${name}, below ${rules.minPoints} points` : `You’re not earning in ${name} yet`,
      body: paid
        ? `About ${formatMon(BigInt(row.estimate ?? "0"))} so far, if the epoch closed now.`
        : row.points > 0
          ? `About ${gap} more activity points and you’re paid: Holders with ${rules.minPoints}+ points share the pool. Posts and replies others back count the most.`
          : `Post, like or reply on the Board to earn a share: every Holder with ${rules.minPoints}+ points is paid, and backing from others counts the most.`,
      href,
    });
  }
  const left = s.endsAt - Math.floor(nowMs / 1000);
  const mine = [...wallets].map((w) => s.activity[w]).find(Boolean);
  const days = row?.days ?? mine?.days ?? 0;
  // In the last day one more active day is all there's time for: a streak that needs more is lost.
  const atRisk = mine && mine.carried > 0 && mine.streak === 0 && rules.streakMinDays - days === 1;
  if (left > 0 && left <= CLOSING_SEC && (row || atRisk) && days < 7) {
    const hours = Math.max(1, Math.ceil(left / 3600));
    out.push({
      key: `club-closing:${s.club}:${s.n}`,
      kind: "club-closing",
      at: nowMs,
      title: `Epoch ${s.n} closes in ${hours}h`,
      body: atRisk
        ? `Post in ${name} today to keep your ${mine.carried}-week streak.`
        : `You were active ${days} of 7 days in ${name}. A post today adds to your bonus.`,
      href,
    });
  }
  return out;
}
