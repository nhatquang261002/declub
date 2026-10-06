import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { toScored, type ActivityEvent } from "./clubs";
import { REWARDS_EPOCH_SECONDS, REWARDS_GENESIS } from "./config";
import { MOMENTUM, memberScore, score } from "./momentum";
import { strengthFactor, type SignalStrength } from "./xPosts";

/**
 * Club Rewards (ADR 0022, docs/09-clubs.md#rewards): each epoch, a share of the protocol fees a
 * Club's swaps paid goes back to the Club. Pure, so the builder, the routes, the screens and the
 * Guide share one set of numbers.
 */
export const REWARDS = {
  /** Of the fees a Club's swaps paid, in basis points: to its Holders, by holdings. */
  holderBps: 4_000,
  /** To the Club fund, which the Club's Owner claims. */
  fundBps: 2_000,
  /** What the protocol keeps. The three add up to 10,000. */
  protocolBps: 4_000,
  /** Shares for an ERC-20 Club without `minHolding`: one per whole token (18 decimals). */
  defaultCoinUnit: 10n ** 18n,
  /**
   * The Holder bonus (ADR 0024): a Holder's shares count up to this much more (basis points) for
   * their activity in the Club during the epoch. Holding stays the base: a quiet Holder keeps theirs.
   */
  maxBonusBps: 5_000,
  /** Activity points that earn the whole bonus: about five swaps, or a week of well-received X posts. */
  fullBonusPoints: 50,
  /** Points per counted X share (halved when it's only weakly about the Club): Momentum's weight. */
  xShareBase: MOMENTUM.xShareWeight,
  /** Points per doubling of an X share's engagement (likes + reposts + quotes + replies). */
  reachWeight: 2,
  /** At most this many reach points per member per Club per epoch, so a viral post can't take it all. */
  reachCapPerEpoch: 30,
} as const;

export const percent = (bps: number) => `${bps / 100}%`;

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

// ─────────────────────────────────────────────────────────────── the split

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

export type Activity = { trading: number; x: number; points: number; bonusBps: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A member's activity in a Club over an epoch (its events only, `end` exclusive), in full with no
 * decay: trading as Momentum weighs it, plus their X shares, each worth `xShareBase` and its reach.
 * The reach read has the last word on an X share: one that was deleted, or edited so it's no longer
 * about the Club, counts for nothing.
 */
export function activityPoints(events: readonly ActivityEvent[], reach: ReachRecord | null, wallets: readonly string[], end: number): Activity {
  const own = new Set(wallets.map((w) => w.toLowerCase()));
  const trades = events.filter((e) => e.kind !== "xshare").map(toScored);
  const trading = memberScore(score(trades, end, { decay: false, windowSec: Number.MAX_SAFE_INTEGER }), [...own]);

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
  const points = trading + x;
  return { trading: round2(trading), x: round2(x), points: round2(points), bonusBps: bonusBps(points) };
}

/** The bonus for `points`, in basis points: linear up to `fullBonusPoints`, then capped. */
export const bonusBps = (points: number) =>
  points <= 0 ? 0 : Math.floor(REWARDS.maxBonusBps * Math.min(1, points / REWARDS.fullBonusPoints));

/** One Club's inputs to an epoch. Amounts are wei. */
export type ClubInput = {
  /** The Club's own asset, lowercase. */
  club: string;
  /** Fees from this epoch's completed swaps that this Club gets to share, already split per Club. */
  fees: bigint;
  /** What earlier epochs couldn't pay out and roll in now. */
  carried: { holders: bigint; fund: bigint };
  /** Each Holder member's display wallet, its shares and its bonus. Zero-share members are left out. */
  holders: { wallet: string; shares: bigint; bonusBps?: number; points?: number }[];
  /** Where the Club fund goes, or null with no Owner. */
  owner: string | null;
};

/** A holder payout also says how it was worked out: the shares held and the bonus they earned. */
export type Payout = { club: string; kind: "holder" | "fund"; amount: bigint; shares?: bigint; bonusBps?: number; points?: number };

export type ClubSplit = {
  club: string;
  fees: bigint;
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

/** A Club's pools for an epoch: its share of the fees, plus whatever rolled in. */
export function pools(fees: bigint, carried: { holders: bigint; fund: bigint }) {
  return {
    holderPool: (fees * BigInt(REWARDS.holderBps)) / 10_000n + carried.holders,
    fundPool: (fees * BigInt(REWARDS.fundBps)) / 10_000n + carried.fund,
  };
}

/**
 * Splits one Club's pools between its Holders and its Owner. A Holder's weight is their shares
 * times (1 + bonus): holding is the base, activity adds up to `maxBonusBps`. Integer wei throughout;
 * rounding dust rolls into the next epoch.
 */
export function splitClub(input: ClubInput): ClubSplit {
  const { holderPool, fundPool } = pools(input.fees, input.carried);
  const holders = input.holders.filter((h) => h.shares > 0n);
  const bonus = (h: ClubInput["holders"][number]) => Math.min(REWARDS.maxBonusBps, Math.max(0, Math.floor(h.bonusBps ?? 0)));
  const weightOf = (h: ClubInput["holders"][number]) => h.shares * BigInt(10_000 + bonus(h));
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
        bonusBps: bonus(h),
        ...(h.points !== undefined ? { points: h.points } : {}),
      });
      paidHolders += amount;
    }
  }
  const paidFund = input.owner && fundPool > 0n ? fundPool : 0n;
  if (paidFund > 0n) payouts.push({ club: input.club, kind: "fund", wallet: input.owner!.toLowerCase(), amount: paidFund });

  return {
    club: input.club,
    fees: input.fees,
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
      const { club, kind, amount, shares, points } = p;
      leaf.breakdown.push({ club, kind, amount, ...(shares !== undefined ? { shares, bonusBps: p.bonusBps } : {}), ...(points !== undefined ? { points } : {}) });
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
export type PublishedPayout = { club: string; kind: Payout["kind"]; amount: string; shares?: string; bonusBps?: number; points?: number };

/** A claimable leaf as `/api/rewards/me` serves it. */
export type ClaimableLeaf = {
  epoch: number;
  account: Address;
  amount: string;
  proof: Hex[];
  breakdown: PublishedPayout[];
};
