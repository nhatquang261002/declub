import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { REWARDS_EPOCH_SECONDS, REWARDS_GENESIS } from "./config";

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

/** One Club's inputs to an epoch. Amounts are wei. */
export type ClubInput = {
  /** The Club's own asset, lowercase. */
  club: string;
  /** Fees from this epoch's completed swaps that this Club gets to share, already split per Club. */
  fees: bigint;
  /** What earlier epochs couldn't pay out and roll in now. */
  carried: { holders: bigint; fund: bigint };
  /** Each Holder member's display wallet and its shares. Zero-share members are left out. */
  holders: { wallet: string; shares: bigint }[];
  /** Where the Club fund goes, or null with no Owner. */
  owner: string | null;
};

export type Payout = { club: string; kind: "holder" | "fund"; amount: bigint };

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

/** Splits one Club's pools between its Holders (by shares) and its Owner. Integer wei throughout. */
export function splitClub(input: ClubInput): ClubSplit {
  const { holderPool, fundPool } = pools(input.fees, input.carried);
  const holders = input.holders.filter((h) => h.shares > 0n);
  const totalShares = holders.reduce((sum, h) => sum + h.shares, 0n);
  const payouts: ClubSplit["payouts"] = [];

  let paidHolders = 0n;
  if (totalShares > 0n) {
    for (const h of holders) {
      const amount = (holderPool * h.shares) / totalShares;
      if (amount === 0n) continue;
      payouts.push({ club: input.club, kind: "holder", wallet: h.wallet.toLowerCase(), amount });
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
      leaf.breakdown.push({ club: p.club, kind: p.kind, amount: p.amount });
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
  leaves: { account: Address; amount: string; proof: Hex[]; breakdown: { club: string; kind: Payout["kind"]; amount: string }[] }[];
};

/** A claimable leaf as `/api/rewards/me` serves it. */
export type ClaimableLeaf = {
  epoch: number;
  account: Address;
  amount: string;
  proof: Hex[];
  breakdown: { club: string; kind: Payout["kind"]; amount: string }[];
};
