import { createPublicClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { deClubIntentsAbi } from "../abi";
import { chain } from "../chain";
import type { ActivityEvent } from "../clubs";
import { CHAIN_ID, DECLUB_INTENTS_ADDRESS, DECLUB_REWARDS_ADDRESS, RPC_URL } from "../config";
import { buildMerkleTree } from "../merkle";
import {
  activityPoints,
  epochWindow,
  leavesOf,
  qualifies,
  rewardLeaf,
  splitClub,
  type ClaimableLeaf,
  type ClubInput,
  type EpochRecord,
  type Holder,
  type ReachRecord,
} from "../rewards";
import { registry, type ClubEntry } from "../verifiedAssets";
import { activeDays } from "./activeDays";
import { nextStreaks, readStreaks, streakAt, streaksKey, type Streaks } from "./streaks";
import { clubEvents } from "./clubs";
import { loadRoles } from "./clubState";
import { allRows, getMember, viemHoldings, type Holdings } from "./members";
import type { Store } from "./store";

/**
 * The rewards epoch builder (ADR 0022). For a finished epoch it takes each Club's completed swaps,
 * the fees they paid, and a fresh read of every member's holdings, and works out who gets what:
 * the top 10 Holders' share by NFT shares × (1 + bonus), the Club fund to the Owner. It stores the result, Merkle proofs
 * included, for `DeClubRewards` and the claim screens. Epochs are built in order and once each,
 * because what one epoch can't pay rolls into the next.
 *
 * It doesn't publish or fund anything on chain: `scripts/rewards-epoch.ts` does that with the
 * operator's key.
 */

const base = `declub:rewards:${CHAIN_ID}`;
export const epochKey = (n: number) => `${base}:epoch:${n}`;
export const epochsKey = () => `${base}:epochs`;
export const accountKey = (account: string) => `${base}:account:${account.toLowerCase()}`;
export const carryKey = (club: string) => `${base}:carry:${club.toLowerCase()}`;
export const lastKey = () => `${base}:last`;
/** The X reach read for epoch `n` before it's built (lib/server/xReach.ts). */
export const reachKey = (n: number) => `${base}:reach:${n}`;
/** A signed swap's settlement fee, read once from its receipt. */
export const feeKey = (txHash: string) => `${base}:fee:${txHash.toLowerCase()}`;
const lockKey = () => `${base}:lock`;

/** Epochs and per-account indexes kept. A year of weekly epochs fits many times over. */
const EPOCHS_KEPT = 10_000;
const ACCOUNT_EPOCHS_KEPT = 1_000;

export type RewardsDeps = {
  /** Unix seconds. */
  now?: () => number;
  clubs?: readonly ClubEntry[];
  /** Every event known for a Club. Defaults to the activity log merged with the pool. */
  events?: (club: ClubEntry) => Promise<ActivityEvent[]>;
  holdings?: Holdings;
  /** What a signed swap's settlement paid in fees, read from its receipt. */
  settlementFee?: (txHash: Hex) => Promise<bigint>;
  /** The intents contract whose settlements need `settlementFee`. */
  intents?: string;
  chainId?: number;
  contract?: Address;
  genesis?: number;
  length?: number;
  /** The X reach for epoch `n`. Defaults to what `collectReach` saved; none means base points only. */
  reach?: (n: number) => Promise<ReachRecord | null>;
};

export type BuildResult =
  | { status: "built"; record: EpochRecord }
  | { status: "exists"; record: EpochRecord }
  /** The epoch hasn't ended yet. */
  | { status: "open"; endsAt: number }
  /** Epochs are built in order: `expected` comes next. */
  | { status: "out_of_order"; expected: number }
  | { status: "busy" }
  /** No rewards contract is configured, so there's nothing to bind leaves to. */
  | { status: "unconfigured" };

let cached: PublicClient | undefined;
const client = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

/** The fees a settlement paid: every `FeeCharged` the intents contract emitted in it. */
export async function viemSettlementFee(txHash: Hex): Promise<bigint> {
  if (!DECLUB_INTENTS_ADDRESS) return 0n;
  const receipt = await client().getTransactionReceipt({ hash: txHash });
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== DECLUB_INTENTS_ADDRESS.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: deClubIntentsAbi, data: log.data, topics: log.topics });
      if (event.eventName === "FeeCharged") total += event.args.amount;
    } catch {
      // Not one of the contract's events.
    }
  }
  return total;
}

/** Builds epoch `n` if it has ended and is next in line. Safe to call again: it never builds twice. */
export async function buildEpoch(store: Store, n: number, deps: RewardsDeps = {}): Promise<BuildResult> {
  const contract = deps.contract ?? DECLUB_REWARDS_ADDRESS;
  if (!contract) return { status: "unconfigured" };
  const window = epochWindow(n, deps.genesis, deps.length);
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  if (now < window.end) return { status: "open", endsAt: window.end };

  const existing = await store.get<EpochRecord>(epochKey(n));
  if (existing) return { status: "exists", record: existing };
  const last = await store.get<number>(lastKey());
  if (last !== null && n !== last + 1) return { status: "out_of_order", expected: last + 1 };

  if ((await store.hit(lockKey(), 600)) > 1) return { status: "busy" };
  try {
    const { record, streaks } = await compute(store, n, window, contract, deps, now);
    await store.set(epochKey(n), record);
    await store.rank(epochsKey(), [{ member: String(n), score: n }], EPOCHS_KEPT);
    for (const leaf of record.leaves) {
      await store.rank(accountKey(leaf.account), [{ member: String(n), score: n }], ACCOUNT_EPOCHS_KEPT);
    }
    for (const club of record.clubs) {
      await store.set(carryKey(club.club), club.carry);
    }
    for (const [club, next] of streaks) {
      await store.set(streaksKey(club), next);
    }
    await store.set(lastKey(), n);
    return { status: "built", record };
  } finally {
    await store.del(lockKey());
  }
}

/** `settlementFee`, remembered per transaction: a settled swap's fee never changes. */
export function cachedSettlementFee(store: Store, read: (txHash: Hex) => Promise<bigint>) {
  return async (txHash: Hex): Promise<bigint> => {
    const known = await store.get<string>(feeKey(txHash));
    if (known !== null) return BigInt(known);
    const fee = await read(txHash);
    await store.set(feeKey(txHash), fee.toString());
    return fee;
  };
}

/** A completed swap's fee: carried by the event, or read from its settlement for a signed swap. */
export async function swapFee(event: ActivityEvent, intents: string, settlementFee: (txHash: Hex) => Promise<bigint>): Promise<bigint> {
  if (event.fee) return BigInt(event.fee);
  return intents && event.contract === intents ? settlementFee(event.deal as Hex) : 0n;
}

/** A Holder as the builder and the standings see them: who they are, and their streak record. */
export type HolderInput = Holder & { userId: string; wallets: string[]; joinedAt: number; days: number; streak: number; points: number; bonusBps: number };

/**
 * One Club's Holders for epoch `n`: shares from a fresh balance read, the activity bonus from the
 * epoch's events, their active days, and the streak those days make. Also gives every member's
 * active days, so the builder can move streaks along for members without shares too.
 */
export async function holderInputs(
  store: Store,
  club: ClubEntry,
  n: number,
  events: readonly ActivityEvent[],
  reach: ReachRecord | null,
  holdings: Holdings,
  streaks: Streaks,
): Promise<{ holders: HolderInput[]; days: Map<string, number> }> {
  const days = await activeDays(store, club.address, n);
  const holders = (await holderShares(store, club, holdings)).map(({ userId, wallet, wallets, shares, joinedAt }) => {
    const mine = days.get(userId) ?? 0;
    const { points, bonusBps } = activityPoints(events, reach, wallets, mine);
    return { userId, wallet, wallets, shares, bonusBps, points, days: mine, streak: streakAt(streaks[userId], n, qualifies(mine)), joinedAt };
  });
  return { holders, days };
}

async function compute(
  store: Store,
  n: number,
  window: { start: number; end: number },
  contract: Address,
  deps: RewardsDeps,
  now: number,
): Promise<{ record: EpochRecord; streaks: Map<string, Streaks> }> {
  const clubs = deps.clubs ?? registry.clubs();
  const eventsOf = deps.events ?? ((club: ClubEntry) => clubEvents(store, club));
  const holdings = deps.holdings ?? viemHoldings;
  const settlementFee = cachedSettlementFee(store, deps.settlementFee ?? viemSettlementFee);
  const intents = (deps.intents ?? DECLUB_INTENTS_ADDRESS ?? "").toLowerCase();

  // Every completed swap in the window, with the Clubs it counts for; and each Club's activity in
  // the window, for the Holder bonus.
  const swaps = new Map<string, { event: ActivityEvent; clubs: Set<string> }>();
  const activity = new Map<string, ActivityEvent[]>();
  for (const club of clubs) {
    const inWindow = (await eventsOf(club)).filter((e) => e.at >= window.start && e.at < window.end);
    activity.set(club.address.toLowerCase(), inWindow);
    for (const event of inWindow) {
      if (event.kind !== "swapped") continue;
      const seen = swaps.get(event.id) ?? { event, clubs: new Set<string>() };
      seen.clubs.add(club.address.toLowerCase());
      swaps.set(event.id, seen);
    }
  }

  // A swap's fee is split evenly between the Clubs it names; the dust stays with the protocol.
  const fees = new Map<string, bigint>();
  for (const { event, clubs: named } of swaps.values()) {
    const fee = await swapFee(event, intents, settlementFee);
    const each = fee / BigInt(named.size);
    for (const club of named) fees.set(club, (fees.get(club) ?? 0n) + each);
  }

  const reach = await (deps.reach ?? ((k: number) => store.get<ReachRecord>(reachKey(k))))(n);
  const inputs: ClubInput[] = [];
  const streaks = new Map<string, Streaks>();
  for (const club of clubs) {
    const key = club.address.toLowerCase();
    const carried = (await store.get<{ holders: string; fund: string }>(carryKey(key))) ?? { holders: "0", fund: "0" };
    const prev = await readStreaks(store, key);
    const { holders, days } = await holderInputs(store, club, n, activity.get(key) ?? [], reach, holdings, prev);
    // Every member's streak moves along, Holder or not: the badge is for posting, the bonus for Holders.
    streaks.set(key, nextStreaks(prev, n, [...days].filter(([, d]) => qualifies(d)).map(([userId]) => userId)));
    inputs.push({
      club: key,
      fees: fees.get(key) ?? 0n,
      carried: { holders: BigInt(carried.holders), fund: BigInt(carried.fund) },
      holders: holders.map(({ wallet, shares, bonusBps, points, days, streak, joinedAt }) => ({ wallet, shares, bonusBps, points, days, streak, joinedAt })),
      owner: await ownerWallet(store, club),
    });
  }

  const splits = inputs.map(splitClub);
  const leaves = leavesOf(splits);
  const chainId = deps.chainId ?? CHAIN_ID;
  const tree = buildMerkleTree(leaves.map((l) => rewardLeaf(chainId, contract, n, l.account, l.amount)));
  const str = (x: bigint) => x.toString();
  const record: EpochRecord = {
    n,
    chainId,
    contract,
    start: window.start,
    end: window.end,
    builtAt: now,
    root: tree.root,
    total: str(leaves.reduce((sum, l) => sum + l.amount, 0n)),
    clubs: splits.map((s) => ({
      club: s.club,
      fees: str(s.fees),
      holderPool: str(s.holderPool),
      fundPool: str(s.fundPool),
      paidHolders: str(s.paidHolders),
      paidFund: str(s.paidFund),
      carry: { holders: str(s.carry.holders), fund: str(s.carry.fund) },
      holderCount: s.holderCount,
    })),
    leaves: leaves.map((l, i) => ({
      account: l.account,
      amount: str(l.amount),
      proof: tree.proofs[i]!,
      breakdown: l.breakdown.map((b) => ({
        club: b.club,
        kind: b.kind,
        amount: str(b.amount),
        ...(b.shares !== undefined ? { shares: str(b.shares), bonusBps: b.bonusBps ?? 0 } : {}),
        ...(b.points !== undefined ? { points: b.points } : {}),
        ...(b.days !== undefined ? { days: b.days } : {}),
        ...(b.streak !== undefined ? { streak: b.streak } : {}),
      })),
    })),
    reach,
  };
  return { record, streaks };
}

/**
 * Each member's shares, from a fresh read of every wallet they've linked: one per NFT of the
 * collection. A Club's memecoin earns the Holder badge but no shares (ADR 0025). Throws when the
 * whole read fails; a single wallet whose balanceOf fails counts as zero.
 */
async function holderShares(store: Store, club: ClubEntry, holdings: Holdings): Promise<{ userId: string; wallet: string; wallets: string[]; shares: bigint; joinedAt: number }[]> {
  const rows = (await allRows(store, club.address)).filter((r) => r.displayWallet && r.wallets.length > 0);
  if (rows.length === 0) return [];
  const balances = await holdings(club.address, rows.flatMap((r) => r.wallets as Address[]));
  if (!balances) throw new Error(`can't read ${club.symbol} balances`);
  let at = 0;
  const shares = rows.map((row) => {
    const held = balances.slice(at, at + row.wallets.length).reduce((sum, b) => sum + b, 0n);
    at += row.wallets.length;
    return held;
  });
  return rows.map((row, i) => ({ userId: row.userId, wallet: row.displayWallet!, wallets: row.wallets, shares: shares[i]!, joinedAt: row.joinedAt })).filter((h) => h.shares > 0n);
}

/** The Owner's display wallet, from the roles and their member row (not the claim, which can go stale). */
export async function ownerWallet(store: Store, club: ClubEntry): Promise<string | null> {
  const { owner } = await loadRoles(store, club.address);
  if (!owner) return null;
  return (await getMember(store, club.address, owner))?.displayWallet ?? null;
}

// ─────────────────────────────────────────────────────────────── reads

export const readEpoch = (store: Store, n: number) => store.get<EpochRecord>(epochKey(n));

/** The newest built epochs, newest first. */
export async function latestEpochs(store: Store, limit = 2): Promise<EpochRecord[]> {
  const ns = await store.ranked(epochsKey(), limit);
  const records = await store.getMany<EpochRecord>(ns.map((n) => epochKey(Number(n))));
  return records.filter((r): r is EpochRecord => r !== null);
}

/** Every leaf `account` has, newest epoch first. Whether each was claimed is read on chain. */
export async function claimableFor(store: Store, account: Address, limit = 52): Promise<ClaimableLeaf[]> {
  const ns = await store.ranked(accountKey(account), limit);
  const records = await store.getMany<EpochRecord>(ns.map((n) => epochKey(Number(n))));
  const out: ClaimableLeaf[] = [];
  for (const record of records) {
    const leaf = record?.leaves.find((l) => l.account.toLowerCase() === account.toLowerCase());
    if (record && leaf) out.push({ epoch: record.n, ...leaf });
  }
  return out;
}

/** What a Club's Rewards tab shows: its line in the latest epochs, what's waiting, and who earned. */
export type ClubRewardsView = {
  epochs: { n: number; start: number; end: number; fees: string; holderPool: string; fundPool: string; paidHolders: string; paidFund: string; holderCount: number }[];
  /** What rolls into the next epoch. */
  carry: { holders: string; fund: string };
  /** The latest epoch's payouts in this Club, largest first, with each Holder's activity bonus. */
  earners: { account: Address; kind: "holder" | "fund"; amount: string; bonusBps?: number }[];
};

export async function clubRewards(store: Store, club: string): Promise<ClubRewardsView> {
  const key = club.toLowerCase();
  const records = await latestEpochs(store, 4);
  const epochs = records.flatMap((r) => {
    const line = r.clubs.find((c) => c.club === key);
    if (!line) return [];
    const { fees, holderPool, fundPool, paidHolders, paidFund, holderCount } = line;
    return [{ n: r.n, start: r.start, end: r.end, fees, holderPool, fundPool, paidHolders, paidFund, holderCount }];
  });
  const latest = records[0];
  const earners = (latest?.leaves ?? [])
    .flatMap((l) =>
      l.breakdown
        .filter((b) => b.club === key)
        .map((b) => ({ account: l.account, kind: b.kind, amount: b.amount, ...(b.bonusBps ? { bonusBps: b.bonusBps } : {}) })),
    )
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0))
    .slice(0, 10);
  const carry = (await store.get<{ holders: string; fund: string }>(carryKey(key))) ?? { holders: "0", fund: "0" };
  return { epochs, carry, earners };
}
