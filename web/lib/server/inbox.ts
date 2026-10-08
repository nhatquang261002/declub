import type { Address } from "viem";
import { CHALLENGE_RULES, assetText, phaseOf, prizeStatus, type StoredChallenge } from "../challenges";
import { isOwnerOrAdmin, roleOf } from "../clubRoles";
import { formatMon } from "../format";
import { DEFAULT_CLUB_RULES, PROTOCOL, entryGap, rampGap } from "../rewards";
import { registry as defaultRegistry, type ClubEntry, type Registry } from "../verifiedAssets";
import type { StoredPost } from "../clubPosts";
import { strengthFactor } from "../xPosts";
import { likesKey, postKey, repliesKey, walletPostsKey } from "./board";
import { challengeKey, challengesKey, entriesKey } from "./challengeState";
import { rewardBans } from "./clubRules";
import { adminIds, loadProfile, loadRoles } from "./clubState";
import { getMember, userClubsKey } from "./members";
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
  /** Waits on the member to do something (an Owner's pick), not just news. */
  actionable?: true;
};

export type InboxKind =
  | "club-like" | "club-pinned" | "club-reward" | "club-reply" | "club-xshare" | "club-rank" | "club-closing"
  | ChallengeKind;

/** What a Club's challenges (ADR 0045) have to say to one member: see `challengeNews`. */
export type ChallengeKind =
  | "challenge-new" | "challenge-ending" | "challenge-won" | "challenge-results" | "challenge-pick" | "challenge-pick-soon"
  | "challenge-prize-sent" | "challenge-prize-owed";

/** Posts older than this don't send news about likes or pins. */
export const INBOX_DAYS = 14;
/** At most this many of a member's recent posts are looked at. */
const POSTS_LOOKED_AT = 60;

/** The standings are read for at most this many of a member's Clubs. */
export const STANDINGS_CLUBS = 5;
/** The last stretch of an epoch, when a nudge to post is worth sending. */
export const CLOSING_SEC = 86_400;

/** The challenges are read for at most this many of a member's Clubs, the latest few in each. */
export const CHALLENGE_CLUBS = 10;
const CHALLENGES_LOOKED_AT = 20;
/** An open challenge the member hasn't entered is "ending" in its last day. */
export const CHALLENGE_ENDING_MS = 86_400_000;
/** The Owner is reminded to pick when this little is left of the pick window. */
export const PICK_SOON_MS = 3 * 86_400_000;

export type InboxDeps = {
  now?: () => number;
  registry?: Registry;
  standings?: (store: Store, club: ClubEntry) => Promise<ClubStandings | null>;
  /** App admins' user ids; defaults to CLUB_ADMIN_USER_IDS. */
  admins?: ReadonlySet<string>;
};

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
      // A challenge entry's X share earns through the challenge (ADR 0048), not as an X share.
      if (share.userId !== userId || share.hidden || share.entry || share.at * 1000 < since) continue;
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
  const admins = deps.admins ?? adminIds();
  for (const club of clubs.slice(0, CHALLENGE_CLUBS)) {
    out.push(...(await challengeNews(store, club, userId, own, admins.has(userId), nowMs)));
  }
  return out.sort((a, b) => b.at - a.at);
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};
/** Judging that ranks its winners, so a win has a place. Others (a raffle, a flat prize) just have winners. */
const RANKED = new Set(["likes", "holders", "owner"]);
const timeLeft = (ms: number) => (ms >= 2 * 86_400_000 ? `${Math.floor(ms / 86_400_000)} days` : `${Math.max(1, Math.ceil(ms / 3_600_000))}h`);

/**
 * A Club's challenges (ADR 0045) as news for one member, read straight from the stored challenges
 * (no settling here, so the bell stays cheap: a challenge's result shows once something has settled
 * it). To a member who could enter, an open one they haven't entered (`challenge-new`, then
 * `challenge-ending` in its last day); to an entrant, how it ended (`challenge-won` or
 * `challenge-results`); to the Owner or an app admin, an Owner-judged one waiting on their pick
 * (`challenge-pick`, then `challenge-pick-soon` near the end of the window). With an asset prize
 * (ADR 0050), the winner hears when theirs is reported sent (`challenge-prize-sent`), and the Owner or
 * an admin is asked to send it while any is owed (`challenge-prize-owed`, news again once overdue).
 * Keys are per challenge, so each is news once. A cancelled challenge says nothing.
 */
export async function challengeNews(store: Store, club: ClubEntry, userId: string, wallets: ReadonlySet<string>, admin: boolean, nowMs: number): Promise<InboxItem[]> {
  const token = club.address.toLowerCase();
  const ids = await store.ranked(challengesKey(token), CHALLENGES_LOOKED_AT);
  if (ids.length === 0) return [];
  const challenges = (await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(token, id)))).filter((c): c is StoredChallenge => !!c && c.state !== "cancelled");
  if (challenges.length === 0) return [];
  const since = nowMs - INBOX_DAYS * 86_400_000;
  const staff = isOwnerOrAdmin(roleOf(await loadRoles(store, token), userId, admin));
  const out: InboxItem[] = [];
  const href = (c: StoredChallenge) => `/clubs/${token}/challenges/${c.id}`;
  const entriesOf = async (c: StoredChallenge) => (await store.members(entriesKey(token, c.id))).flatMap((m) => {
    const at = m.indexOf("|");
    return at > 0 ? [{ post: m.slice(0, at), userId: m.slice(at + 1) }] : [];
  });
  // Who can enter at all, read once and only when an open challenge asks: the Owner and admins
  // don't compete, nor a member banned from rewards, and a Holders-only one wants the badge.
  let canEnter: { any: boolean; holder: boolean } | undefined;
  const eligible = async (c: StoredChallenge) => {
    if (!canEnter) {
      const any = !staff && club.club !== "archived" && !(userId in (await rewardBans(store, token)));
      canEnter = { any, holder: any && (await getMember(store, token, userId))?.holder === true };
    }
    return canEnter.any && (!c.holdersOnly || canEnter.holder);
  };

  for (const c of challenges) {
    const phase = phaseOf(c, nowMs);
    if (phase === "open") {
      if (!(await eligible(c)) || (await entriesOf(c)).some((e) => e.userId === userId)) continue;
      const left = c.endsAt - nowMs;
      if (left <= CHALLENGE_ENDING_MS) {
        out.push({
          key: `challenge-ending:${token}:${c.id}`,
          kind: "challenge-ending",
          at: c.endsAt - CHALLENGE_ENDING_MS,
          title: `“${c.title}” ends in ${timeLeft(left)}`,
          body: `You haven’t entered yet. Share an X post to ${club.name}’s challenge before it closes.`,
          href: href(c),
        });
      } else if (c.startsAt >= since) {
        out.push({
          key: `challenge-new:${token}:${c.id}`,
          kind: "challenge-new",
          at: c.startsAt,
          title: `New challenge in ${club.name}: “${c.title}”`,
          body: `${c.holdersOnly ? "For Holders. " : ""}${c.brief.length > 90 ? `${c.brief.slice(0, 87)}…` : c.brief}`,
          href: href(c),
        });
      }
    } else if (phase === "judging" && staff) {
      // Nothing to pick from, nothing to ask; past the window it expires on its next settle.
      const pickBy = c.endsAt + CHALLENGE_RULES.pickWindowMs;
      if (nowMs >= pickBy || (await store.countMembers(entriesKey(token, c.id))) === 0) continue;
      const soon = pickBy - nowMs <= PICK_SOON_MS;
      out.push({
        key: `${soon ? "challenge-pick-soon" : "challenge-pick"}:${token}:${c.id}`,
        kind: soon ? "challenge-pick-soon" : "challenge-pick",
        at: soon ? pickBy - PICK_SOON_MS : c.endsAt,
        title: `Pick the winners of “${c.title}”`,
        body: soon
          ? `${timeLeft(pickBy - nowMs)} left to pick in ${club.name}. Without a pick it ends with no winners.`
          : `It has ended in ${club.name}. Its entries are waiting for your pick.`,
        href: href(c),
        actionable: true,
      });
    } else if (phase === "settled" && c.settled) {
      const settled = c.settled;
      const asset = c.rewards?.asset;
      if (staff && asset) {
        // The Owner's to send, from their own wallet: asked while any winner waits, again once it's overdue.
        const owed = settled.winners.filter((w) => w.prize && !w.sent);
        if (owed.length > 0) {
          const overdue = owed.some((w) => prizeStatus(w, settled.at, nowMs) === "overdue");
          out.push({
            key: `challenge-prize-owed:${token}:${c.id}${overdue ? ":overdue" : ""}`,
            kind: "challenge-prize-owed",
            at: overdue ? settled.at + CHALLENGE_RULES.prizeDueMs : settled.at,
            title: `Send the prize${owed.length === 1 ? "" : "s"} for “${c.title}”`,
            body: overdue
              ? `It’s overdue in ${club.name}: members see “Prize not sent” until you send it and mark it sent.`
              : `${owed.length} winner${owed.length === 1 ? " is" : "s are"} waiting in ${club.name}. Send it from your wallet, then mark it sent.`,
            href: href(c),
            actionable: true,
          });
        }
      }
      const mine = await entriesOf(c);
      const posts = new Set(mine.filter((e) => e.userId === userId).map((e) => e.post));
      const won = settled.winners.find((w) => wallets.has(w.wallet.toLowerCase()) || posts.has(w.post));
      if (won?.sent && asset && won.prize && won.sent.at >= since) {
        out.push({
          key: `challenge-prize-sent:${token}:${c.id}`,
          kind: "challenge-prize-sent",
          at: won.sent.at,
          title: `Your prize for “${c.title}” was sent`,
          body: `${assetText(asset, won.prize)} from the Owner of ${club.name}. The app checked the transfer on chain.`,
          href: href(c),
        });
      }
      if (settled.at < since) continue;
      if (won) {
        const prize = asset && won.prize ? ` The Owner sends you ${assetText(asset, won.prize)}.` : "";
        out.push({
          key: `challenge-won:${token}:${c.id}`,
          kind: "challenge-won",
          at: settled.at,
          title: RANKED.has(c.judging) ? `You won ${ordinal(won.place)} place in “${c.title}”` : `You’re a winner of “${c.title}”`,
          body: (won.points > 0 ? `+${won.points} points toward your rewards in ${club.name}.` : `See the results in ${club.name}.`) + prize,
          href: href(c),
        });
      } else if (posts.size > 0) {
        out.push({
          key: `challenge-results:${token}:${c.id}`,
          kind: "challenge-results",
          at: settled.at,
          title: `Results are in: “${c.title}”`,
          body: settled.winners.length > 0 ? `See who won in ${club.name}.` : `It ended in ${club.name} with no winners.`,
          href: href(c),
        });
      }
    }
  }
  return out;
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
      title: paid ? `You’re #${row.rank} in ${name} this epoch` : row.points > 0 ? `You’re #${row.rank} in ${name}, outside the paid places` : `You’re not earning in ${name} yet`,
      body: paid
        ? `About ${formatMon(BigInt(row.estimate ?? "0"))} so far, if the epoch closed now.${row.points < rules.rampPoints ? ` ${rampGap(row.points, rules)} more points pays your whole share.` : ""}`
        : row.points > 0
          ? `About ${gap} more activity points would put you in the paid places. Posts and replies others back count the most.`
          : `Post, like or reply on the Board to earn a share: active Holders are paid, a whole share from ${rules.rampPoints} points, and backing from others counts the most.`,
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
