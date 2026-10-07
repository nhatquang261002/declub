import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import type { ActivityEvent } from "./clubs";
import { REWARDS_EPOCH_SECONDS, REWARDS_GENESIS } from "./config";
import { MOMENTUM } from "./momentum";
import { strengthFactor, type SignalStrength } from "./xPosts";

/**
 * Club Rewards (ADR 0022, docs/09-clubs.md#rewards): each epoch, a share of the protocol fees a
 * Club's swaps paid goes back to the Club. Pure, so the builder, the routes, the screens and the
 * Guide share one set of numbers.
 */
export const REWARDS = {
  /** Of the fees a Club's swaps paid, in basis points: to its most active Holders, by holdings and activity. */
  holderBps: 5_000,
  /** Only a Club's most active Holders share the Holder pool (ADR 0037): fewer claims, and you have to hold and take part. */
  maxHolders: 10,
  /** To the Club fund, which the Club's Owner claims. */
  fundBps: 2_500,
  /** What the protocol keeps. The three add up to 10,000. */
  protocolBps: 2_500,
  /**
   * The Holder bonus (ADR 0024): a Holder's shares count up to this much more (basis points) for
   * their activity in the Club during the epoch. Holding stays the base: a quiet Holder keeps theirs.
   */
  maxBonusBps: 5_000,
  /** Activity points that earn the whole bonus: a week of posting on the Board every day and sharing an own X post each day. */
  fullBonusPoints: 35,
  /** Points per active day (ADR 0032): a UTC day with a visible Board post by the member in the Club. */
  dayPoints: 2,
  /** An epoch with at least this many active days keeps a member's streak going. */
  streakMinDays: 3,
  /** The streak bonus (basis points) per qualifying epoch in a row after the first. */
  streakStepBps: 250,
  /** At most this much streak bonus, on top of `maxBonusBps`. */
  maxStreakBps: 1_000,
  /**
   * Points per completed swap with a counterparty who isn't the member's own wallet (ADR 0034). A
   * swap with a wallet the member already swapped with in the epoch within `MOMENTUM.washDays`
   * counts `MOMENTUM.washFactor` of it.
   */
  swapPoints: 2,
  /** At most this many swap points per member per Club per epoch, so trading can't carry the bonus (7 full swaps). */
  swapCapPerEpoch: 14,
  /** Points per counted X share (halved when it's only weakly about the Club): Momentum's weight. */
  xShareBase: MOMENTUM.xShareWeight,
  /** Points per doubling of an X share's engagement (likes + reposts + quotes + replies). */
  reachWeight: 2,
  /** At most this many reach points per member per Club per epoch, so a viral post can't take it all. */
  reachCapPerEpoch: 30,
} as const;

export const percent = (bps: number) => `${bps / 100}%`;

const DAY = 86_400;

// ─────────────────────────────────────────────────────────────── epochs

export type EpochWindow = { n: number; start: number; end: number };

/** The epoch `n`: `[start, end)` in unix seconds. */
export function epochWindow(n: number, genesis = REWARDS_GENESIS, length = REWARDS_EPOCH_SECONDS): EpochWindow {
  const start = genesis + n * length;
  return { n, start, end: start + length };
}

/** The epoch running at `now` (unix seconds); -1 before genesis. */
export function epochAt(now: number, genesis = REWARDS_GENESIS, length = REWARDS_EPOCH_SECONDS): number {
  return now < genesis ? -1 : Math.floor((now - genesis) / length);
}

// ─────────────────────────────────────────────────────────────── leaves

/**
 * The leaf `DeClubRewards.leaf(epoch, account, amount)` checks: hashed twice, and bound to the
 * chain and the contract so a proof can't be replayed against another deployment.
 */
export function rewardLeaf(chainId: number, contract: Address, epoch: number, account: Address, amount: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "address" }, { type: "uint256" }],
      [BigInt(chainId), contract, BigInt(epoch), account, amount],
    ),
  );
  return keccak256(inner);
}

// ─────────────────────────────────────────────────────────────── the Holder bonus

/** One counted X share's reach, read from the X API before the epoch is built (lib/server/xReach.ts). */
export type ReachEntry = {
  club: string;
  /** The member's Club wallet when they shared it. */
  wallet: string;
  /** Still their own post and still about the Club. A deleted post isn't. */
  ok: boolean;
  strength: SignalStrength | null;
  /** Likes + reposts + quotes + replies. */
  engagement: number;
  reason?: "deleted" | "not_author" | "no_signal" | "no_account";
};

/** Every counted X share's reach for an epoch, by X post id. Published with the epoch. */
export type ReachRecord = {
  n: number;
  /** Unix seconds. */
  collectedAt: number;
  /** False without X_BEARER_TOKEN: X shares then count their base points, with no reach. */
  available: boolean;
  posts: Record<string, ReachEntry>;
};

/**
 * Money a sponsor adds to one Club's Holder pool for one epoch (ADR 0035). The operator records it
 * before the epoch is built, from MON the sponsor sent to the operator; the epoch publishes it.
 */
export type Sponsorship = {
  club: string;
  /** Wei, a decimal string. */
  amount: string;
  /** Shown on the Rewards tab and in the recap. */
  sponsor: string;
  /** A project's own top-up, or someone else's. */
  kind: "owner" | "partner";
  /** Unix seconds it was recorded. */
  at: number;
  /** The wallet that paid, and its transaction, when the app checked the payment on chain (ADR 0036). */
  by?: string;
  tx?: string;
};

/** The longest sponsor name kept. */
export const SPONSOR_NAME_MAX = 40;

/** A Club's sponsors in one epoch, as published. */
export type PublishedSponsor = { sponsor: string; kind: Sponsorship["kind"]; amount: string; by?: string };

/** The least a sponsorship made in the app can be, in wei (0.1 MON): enough that a name isn't free. */
export const SPONSOR_MIN_WEI = 10n ** 17n;

/** What the sponsor signs to claim a payment as theirs, under a name (ADR 0036). Nobody else can put their name on it. */
export const sponsorMessage = (club: string, tx: string, name: string) =>
  `DeClub sponsorship\nClub: ${club.toLowerCase()}\nPayment: ${tx.toLowerCase()}\nName: ${name}`;

export type Activity = { x: number; days: number; swaps: number; points: number; bonusBps: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A member's activity in a Club over an epoch: their active days on the Board, each worth
 * `dayPoints` (ADR 0032), their own X shares, each worth `xShareBase` and its reach, and their
 * completed swaps (`swapPoints`, ADR 0034). At most 7 active days count. The reach read has the last
 * word on an X share: one that was deleted, or edited so it's no longer about the Club, counts for nothing.
 */
export function activityPoints(events: readonly ActivityEvent[], reach: ReachRecord | null, wallets: readonly string[], days = 0): Activity {
  const own = new Set(wallets.map((w) => w.toLowerCase()));
  let base = 0;
  let reached = 0;
  for (const e of events) {
    if (e.kind !== "xshare" || !own.has(e.parties[0] ?? "")) continue;
    const read = reach?.available ? reach.posts[e.deal] : undefined;
    const factor = read ? (read.ok ? strengthFactor(read.strength) : 0) : (e.weight ?? 1);
    base += REWARDS.xShareBase * factor;
    if (read?.ok) reached += REWARDS.reachWeight * Math.log2(1 + read.engagement) * factor;
  }
  const x = base + Math.min(REWARDS.reachCapPerEpoch, reached);
  const swaps = swapActivity(events, own);
  const active = Math.max(0, Math.min(7, Math.floor(days)));
  const points = x + swaps + active * REWARDS.dayPoints;
  return { x: round2(x), days: active, swaps: round2(swaps), points: round2(points), bonusBps: bonusBps(points) };
}

/**
 * A member's swap points in an epoch (ADR 0034). A swap counts when someone other than the member's
 * own wallets is on it, so swapping between one's own wallets earns nothing. Swapping again with a
 * counterparty within `MOMENTUM.washDays` counts `MOMENTUM.washFactor` of a swap, as in Momentum,
 * and the total is capped at `swapCapPerEpoch`.
 */
function swapActivity(events: readonly ActivityEvent[], own: ReadonlySet<string>): number {
  const swaps = events.filter((e) => e.kind === "swapped" && e.parties.some((p) => own.has(p.toLowerCase()))).sort((a, b) => a.at - b.at);
  const lastWith = new Map<string, number>();
  let points = 0;
  for (const e of swaps) {
    const others = [...new Set(e.parties.map((p) => p.toLowerCase()))].filter((p) => !own.has(p));
    if (others.length === 0) continue;
    const repeat = others.some((o) => {
      const previous = lastWith.get(o);
      return previous !== undefined && e.at - previous <= MOMENTUM.washDays * DAY;
    });
    for (const o of others) lastWith.set(o, e.at);
    points += REWARDS.swapPoints * (repeat ? MOMENTUM.washFactor : 1);
  }
  return Math.min(REWARDS.swapCapPerEpoch, points);
}

/** The bonus for `points`, in basis points: linear up to `fullBonusPoints`, then capped. */
export const bonusBps = (points: number) =>
  points <= 0 ? 0 : Math.floor(REWARDS.maxBonusBps * Math.min(1, points / REWARDS.fullBonusPoints));

/**
 * The streak bonus for `streak` qualifying epochs in a row, this one included (ADR 0032): nothing
 * for the first, then `streakStepBps` more each epoch, up to `maxStreakBps`.
 */
export const streakBps = (streak: number) =>
  streak <= 1 ? 0 : Math.min(REWARDS.maxStreakBps, REWARDS.streakStepBps * (Math.floor(streak) - 1));

/** Whether an epoch with `days` active days keeps a streak going. */
export const qualifies = (days: number) => days >= REWARDS.streakMinDays;

/** One Club's inputs to an epoch. Amounts are wei. */
export type ClubInput = {
  /** The Club's own asset, lowercase. */
  club: string;
  /** Fees from this epoch's completed swaps that this Club gets to share, already split per Club. */
  fees: bigint;
  /** What earlier epochs couldn't pay out and roll in now. */
  carried: { holders: bigint; fund: bigint };
  /** Sponsors' money for this epoch (ADR 0035): all of it joins the Holder pool, none to the protocol. */
  sponsored?: bigint;
  /**
   * Each Holder member's display wallet, its shares and its bonus. Zero-share members are left out.
   * `joinedAt` (unix seconds) breaks a tie at the cutoff in favour of the earlier member.
   */
  holders: Holder[];
  /** Where the Club fund goes, or null with no Owner. */
  owner: string | null;
};

/**
 * One Holder member. `bonusBps` is the activity bonus and `streak` the qualifying epochs in a row;
 * `points` and `days` say how the bonus was earned.
 */
export type Holder = { wallet: string; shares: bigint; bonusBps?: number; points?: number; days?: number; streak?: number; joinedAt?: number };

/** A holder payout also says how it was worked out: the shares held and the bonus they earned. */
export type Payout = {
  club: string;
  kind: "holder" | "fund";
  amount: bigint;
  shares?: bigint;
  /** The whole bonus: activity plus streak. */
  bonusBps?: number;
  points?: number;
  days?: number;
  streak?: number;
};

export type ClubSplit = {
  club: string;
  fees: bigint;
  sponsored: bigint;
  holderPool: bigint;
  fundPool: bigint;
  /** Paid this epoch, per kind. */
  paidHolders: bigint;
  paidFund: bigint;
  /** Rolls into the next epoch: no Holders or no Owner, plus rounding dust. */
  carry: { holders: bigint; fund: bigint };
  holderCount: number;
  payouts: (Payout & { wallet: string })[];
};

/** A Club's pools for an epoch: its share of the fees, whatever rolled in, and what sponsors added to the Holder pool. */
export function pools(fees: bigint, carried: { holders: bigint; fund: bigint }, sponsored = 0n) {
  return {
    holderPool: (fees * BigInt(REWARDS.holderBps)) / 10_000n + carried.holders + sponsored,
    fundPool: (fees * BigInt(REWARDS.fundBps)) / 10_000n + carried.fund,
  };
}

/**
 * Holders in the order the Holder pool reads them (ADR 0037): most activity points first, then the
 * bigger holding, the earlier member, the lower wallet, so a rebuild gives the same order.
 * Zero-share members are left out. A Holder with no points is ranked but never paid: `paidPlaces`.
 */
export function rankHolders<H extends Holder>(holders: readonly H[]): H[] {
  return holders
    .filter((h) => h.shares > 0n)
    .sort(
      (a, b) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        (a.shares === b.shares ? 0 : a.shares > b.shares ? -1 : 1) ||
        (a.joinedAt ?? 0) - (b.joinedAt ?? 0) ||
        (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1),
    );
}

/** The Holders the pool pays: the `maxHolders` most active of those ranked, and only with some activity. */
export function paidPlaces<H extends Holder>(ranked: readonly H[]): H[] {
  return ranked.filter((h) => (h.points ?? 0) > 0).slice(0, REWARDS.maxHolders);
}

/**
 * How many more activity points `wallet` needs to be among the paid Holders: 0 when it already is,
 * null when it isn't ranked at all (it holds nothing). With fewer than `maxHolders` active Holders
 * any activity is enough, so the answer is the smallest step a point can make.
 */
export function entryGap(ranked: readonly Holder[], wallet: string): number | null {
  const at = ranked.findIndex((h) => h.wallet.toLowerCase() === wallet.toLowerCase());
  if (at < 0) return null;
  const me = ranked[at]!;
  const paid = paidPlaces(ranked);
  if (paid.includes(me)) return 0;
  if (paid.length < REWARDS.maxHolders) return 0.01;
  const last = paid[paid.length - 1]!;
  const winsTie = rankHolders([{ ...me, points: last.points }, last])[0] !== last;
  return Number((Math.max(0, (last.points ?? 0) - (me.points ?? 0)) + (winsTie ? 0 : 0.01)).toFixed(2));
}

/** A Holder's whole bonus in basis points: activity (capped at `maxBonusBps`) plus streak. */
export function totalBonusBps(h: Pick<Holder, "bonusBps" | "streak">): number {
  const activity = Math.min(REWARDS.maxBonusBps, Math.max(0, Math.floor(h.bonusBps ?? 0)));
  return activity + streakBps(h.streak ?? 0);
}

/**
 * Splits one Club's pools between its Holders and its Owner. Only the `maxHolders` most active
 * Holders are paid (`paidPlaces`: the top of `rankHolders`, with some activity). Among them a
 * Holder's weight is their shares times (1 + bonus): holding is the base, activity adds up to
 * `maxBonusBps` and a streak up to `maxStreakBps`. Integer wei throughout; rounding dust rolls into
 * the next epoch.
 */
export function splitClub(input: ClubInput): ClubSplit {
  const { holderPool, fundPool } = pools(input.fees, input.carried, input.sponsored ?? 0n);
  const holders = paidPlaces(rankHolders(input.holders));
  const weightOf = (h: Holder) => h.shares * BigInt(10_000 + totalBonusBps(h));
  const totalWeight = holders.reduce((sum, h) => sum + weightOf(h), 0n);
  const payouts: ClubSplit["payouts"] = [];

  let paidHolders = 0n;
  if (totalWeight > 0n) {
    for (const h of holders) {
      const amount = (holderPool * weightOf(h)) / totalWeight;
      if (amount === 0n) continue;
      payouts.push({
        club: input.club,
        kind: "holder",
        wallet: h.wallet.toLowerCase(),
        amount,
        shares: h.shares,
        bonusBps: totalBonusBps(h),
        ...(h.points !== undefined ? { points: h.points } : {}),
        ...(h.days !== undefined ? { days: h.days } : {}),
        ...(h.streak !== undefined ? { streak: h.streak } : {}),
      });
      paidHolders += amount;
    }
  }
  const paidFund = input.owner && fundPool > 0n ? fundPool : 0n;
  if (paidFund > 0n) payouts.push({ club: input.club, kind: "fund", wallet: input.owner!.toLowerCase(), amount: paidFund });

  return {
    club: input.club,
    fees: input.fees,
    sponsored: input.sponsored ?? 0n,
    holderPool,
    fundPool,
    paidHolders,
    paidFund,
    carry: { holders: holderPool - paidHolders, fund: fundPool - paidFund },
    holderCount: holders.length,
    payouts,
  };
}

/** One account's leaf: everything it earned this epoch, across Clubs, with the breakdown. */
export type Leaf = { account: Address; amount: bigint; breakdown: Payout[] };

/** Sums every Club's payouts per wallet, ordered by address so a rebuild gives the same tree. */
export function leavesOf(splits: readonly ClubSplit[]): Leaf[] {
  const byWallet = new Map<string, Leaf>();
  for (const split of splits) {
    for (const p of split.payouts) {
      const leaf = byWallet.get(p.wallet) ?? { account: getAddress(p.wallet), amount: 0n, breakdown: [] };
      leaf.amount += p.amount;
      const { club, kind, amount, shares, points, days, streak } = p;
      leaf.breakdown.push({
        club,
        kind,
        amount,
        ...(shares !== undefined ? { shares, bonusBps: p.bonusBps } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(days !== undefined ? { days } : {}),
        ...(streak !== undefined ? { streak } : {}),
      });
      byWallet.set(p.wallet, leaf);
    }
  }
  return [...byWallet.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, leaf]) => leaf);
}

// ─────────────────────────────────────────────────────────────── what the API serves

/** An epoch as stored and published. Amounts are decimal strings so it round-trips as JSON. */
export type EpochRecord = {
  n: number;
  chainId: number;
  contract: Address;
  start: number;
  end: number;
  /** Unix seconds the builder ran (and read Holder balances). */
  builtAt: number;
  root: Hex;
  total: string;
  clubs: {
    club: string;
    fees: string;
    /** What sponsors added to the Holder pool (ADR 0035); absent in epochs built before. */
    sponsored?: string;
    sponsors?: PublishedSponsor[];
    holderPool: string;
    fundPool: string;
    paidHolders: string;
    paidFund: string;
    carry: { holders: string; fund: string };
    holderCount: number;
  }[];
  leaves: { account: Address; amount: string; proof: Hex[]; breakdown: PublishedPayout[] }[];
  /** The X reach the Holder bonus used (ADR 0024), or null when none was read. */
  reach?: ReachRecord | null;
};

/** A payout as published: amounts as decimal strings. */
export type PublishedPayout = { club: string; kind: Payout["kind"]; amount: string; shares?: string; bonusBps?: number; points?: number; days?: number; streak?: number };

/** A claimable leaf as `/api/rewards/me` serves it. */
export type ClaimableLeaf = {
  epoch: number;
  account: Address;
  amount: string;
  proof: Hex[];
  breakdown: PublishedPayout[];
};
