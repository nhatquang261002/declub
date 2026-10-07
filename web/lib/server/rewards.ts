import { createPublicClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { deClubIntentsAbi } from "../abi";
import { chain } from "../chain";
import type { ActivityEvent } from "../clubs";
import { CHAIN_ID, DECLUB_INTENTS_ADDRESS, DECLUB_REWARDS_ADDRESS, RPC_URL } from "../config";
import { buildMerkleTree } from "../merkle";
import {
  DEFAULT_CLUB_RULES,
  PROTOCOL,
  activityPoints,
  averageHeld,
  backingPoints,
  epochAt,
  epochWindow,
  leavesOf,
  paidPlaces,
  qualifies,
  rankHolders,
  totalBonusBps,
  rewardLeaf,
  splitClub,
  type ClaimableLeaf,
  type ClubInput,
  type BackingAction,
  type ClubRules,
  type EpochRecord,
  type Holder,
  type PublishedSponsor,
  type ReachRecord,
  type Sponsorship,
  type Voice,
} from "../rewards";
import { registry, type ClubEntry } from "../verifiedAssets";
import { activeDays } from "./activeDays";
import { backingRecordKey, publishBacking, readBacking, voicesFor, type PublishedBacking } from "./backing";
import { rulesFor } from "./clubRules";
import { readHeld } from "./held";
import { nextStreaks, readStreaks, standingsKey, streakAt, streaksKey, type Streaks } from "./streaks";
import { clubEvents } from "./clubs";
import { loadRoles } from "./clubState";
import { cleanSponsorName, readSponsors, sponsorKey, sponsorsByClub } from "./sponsors";
import { allRows, getMember, viemHoldings, type Holdings } from "./members";
import type { Store } from "./store";

/**
 * The rewards epoch builder (ADR 0022). For a finished epoch it takes each Club's completed swaps,
 * the fees they paid, and a fresh read of every member's holdings, and works out who gets what:
 * every Holder's share with at least the points floor by NFTs held on average × (1 + bonus), the Club fund to the Owner. It stores the result, Merkle proofs
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

/** Epoch `n`'s final points for every Holder, by Club: the ledger a member's history and anyone's recomputation read (ADR 0040). */
export const pointsKey = (n: number) => `${base}:points:${n}`;

/** A Holder's final epoch, by public wallet. Never carries a user id or a second wallet. */
export type LedgerRow = {
  wallet: string;
  /** NFTs held at the close, and on average over the epoch (2 decimals). */
  shares: string;
  held: number;
  points: number;
  /** Of `points`: active days, X shares, swaps and others' backing, which came from this many members and this much from base voices. */
  days: number;
  xPoints: number;
  swapPoints: number;
  backedPoints: number;
  backers: number;
  basePoints: number;
  /** The whole bonus: activity plus streak, in basis points, and the streak in epochs. */
  bonusBps: number;
  streak: number;
  /** At or above the floor with an NFT at the close: paid a share of the Holder pool. */
  paid: boolean;
};

export type PublishedLedger = { closedAt: number; rules: ClubRules; samples: number; rows: LedgerRow[] };

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
  /** A Club's rules for epoch `n`. Defaults to `rulesFor`; tests give their own. */
  rules?: (club: string, n: number) => Promise<ClubRules> | ClubRules;
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

export type SponsorResult =
  | { status: "recorded"; entries: Sponsorship[] }
  /** The epoch is already built: its pools are fixed. Record it for the next one. */
  | { status: "built" }
  /** Another sponsorship for this epoch is being written; try again in a moment. */
  | { status: "busy" }
  | { status: "invalid"; message: string };

/**
 * Records money a sponsor sent the operator for Club `club` in epoch `n` (ADR 0035). It joins that
 * Club's Holder pool when the epoch is built, so it has to be recorded before then.
 */
export async function recordSponsor(
  store: Store,
  n: number,
  input: { club: string; amount: bigint; sponsor: string; kind: Sponsorship["kind"]; by?: string; tx?: string },
  now = Math.floor(Date.now() / 1000),
): Promise<SponsorResult> {
  const sponsor = cleanSponsorName(input.sponsor);
  if (!Number.isInteger(n) || n < 0) return { status: "invalid", message: "Give an epoch number." };
  if (input.amount <= 0n) return { status: "invalid", message: "The amount must be more than zero." };
  if (!sponsor) return { status: "invalid", message: "Give the sponsor a name." };
  if (await store.get<EpochRecord>(epochKey(n))) return { status: "built" };
  // The ledger is one value, so two writers at once would lose one: take turns.
  const lock = `${sponsorKey(n)}:lock`;
  if ((await store.hit(lock, 10)) > 1) return { status: "busy" };
  try {
    return await append(store, n, input, sponsor, now);
  } finally {
    await store.del(lock);
  }
}

/**
 * Takes an entry out of epoch `n`'s ledger by its transaction, for a name that shouldn't be shown.
 * The money stays with the operator; the payment stays recorded as taken, so it isn't added again.
 */
export async function removeSponsor(store: Store, n: number, tx: string): Promise<{ status: "removed"; entry: Sponsorship } | { status: "built" } | { status: "missing" }> {
  if (await store.get<EpochRecord>(epochKey(n))) return { status: "built" };
  const lock = `${sponsorKey(n)}:lock`;
  if ((await store.hit(lock, 10)) > 1) return { status: "missing" };
  try {
    const entries = await readSponsors(store, n);
    const at = entries.findIndex((e) => e.tx === tx.toLowerCase());
    if (at < 0) return { status: "missing" };
    const [entry] = entries.splice(at, 1);
    await store.set(sponsorKey(n), entries);
    // The live standings are cached for minutes: drop this Club's copy so the pool shows the change now.
    await store.del(standingsKey(entry!.club));
    return { status: "removed", entry: entry! };
  } finally {
    await store.del(lock);
  }
}

async function append(
  store: Store,
  n: number,
  input: { club: string; amount: bigint; kind: Sponsorship["kind"]; by?: string; tx?: string },
  sponsor: string,
  now: number,
): Promise<SponsorResult> {
  // Built while this call waited for its turn: the pools are fixed.
  if (await store.get<EpochRecord>(epochKey(n))) return { status: "built" };
  const entries = await readSponsors(store, n);
  entries.push({
    club: input.club.toLowerCase(),
    amount: input.amount.toString(),
    sponsor,
    kind: input.kind,
    at: now,
    ...(input.by ? { by: input.by.toLowerCase() } : {}),
    ...(input.tx ? { tx: input.tx.toLowerCase() } : {}),
  });
  await store.set(sponsorKey(n), entries);
  // The live standings are cached for minutes: drop this Club's copy so the pool shows the money now.
  await store.del(standingsKey(input.club));
  return { status: "recorded", entries };
}

let cached: PublicClient | undefined;
export const chainClient = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

/** The fees a settlement paid: every `FeeCharged` the intents contract emitted in it. */
export async function viemSettlementFee(txHash: Hex): Promise<bigint> {
  if (!DECLUB_INTENTS_ADDRESS) return 0n;
  const receipt = await chainClient().getTransactionReceipt({ hash: txHash });
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
    const { record, streaks, backing, ledger } = await compute(store, n, window, contract, deps, now);
    await store.set(backingRecordKey(n), backing);
    await store.set(pointsKey(n), ledger);
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
export type HolderInput = Holder & {
  userId: string;
  wallets: string[];
  joinedAt: number;
  days: number;
  streak: number;
  points: number;
  bonusBps: number;
  /** Of `points`: from X shares, from swaps, and from others' backing (ADR 0038, ADR 0039). */
  xPoints: number;
  swapPoints: number;
  backedPoints: number;
  /** How many members backed them. */
  backers: number;
  /** Of `backedPoints`: from base voices (ADR 0039), at most `baseCapPerReceiver`. */
  basePoints: number;
};

/** The latest a profile can have been shared and still give a base voice in an epoch ending at `end` (unix seconds): epoch ms. */
export const verifiedBy = (end: number) => (end - PROTOCOL.verifiedDays * 86_400) * 1000;

/** What was read of the epoch's backing, to publish (ADR 0040). */
type BackingRead = {
  actions: readonly BackingAction[];
  removed: readonly BackingAction[];
  voices: ReadonlyMap<string, Voice>;
  /** Every member's Club wallet, by user id. */
  wallets: ReadonlyMap<string, string>;
};

/** One Holder as frozen at the close (ADR 0040). Server-private: the linked wallets and user id are never published. */
export type ClosingHolder = {
  userId: string;
  wallet: string;
  wallets: string[];
  /** NFTs held at the close, and the NFT reads added up (the daily samples and the close), decimal strings. */
  shares: string;
  held: string;
  joinedAt: number;
  days: number;
  /** Of the points: others' backing, how many gave it, and how much of it came from base voices. */
  backed: number;
  backers: number;
  base: number;
};

/**
 * One Club's epoch inputs, frozen when the epoch closes (ADR 0040): holdings and their average, the
 * backing and active days that still stood, and the rules. The build scores from this, so a like
 * taken back, a post deleted or a moderator's hide after the close can't move the result. What the
 * chain and X say (swaps, X shares and their reach) is read when the epoch is built.
 */
export type Closing = {
  n: number;
  /** Unix seconds the snapshot was taken. */
  closedAt: number;
  rules: ClubRules;
  /** Daily holdings samples the `held` totals add up, not counting the read at the close. */
  samples: number;
  holders: ClosingHolder[];
  /** Every member's active days, by user id: streaks move for members without shares too. */
  days: Record<string, number>;
  /** Who backed whom, by public wallet. Published with the epoch. */
  backing: PublishedBacking;
};

export const closingKey = (club: string, n: number) => `${base}:closing:${club.toLowerCase()}:${n}`;

/** Reads one Club's epoch inputs now: a fresh balance read, the holdings samples, the backing and active days that stand. */
async function readInputs(store: Store, club: ClubEntry, n: number, holdings: Holdings, linkedBy: number, rules: ClubRules) {
  const held = await holderShares(store, club, holdings);
  const sampled = await readHeld(store, club.address, n);
  const samples = sampled.days.length;
  // The close counts as one more read. A member sampled earlier keeps that voice even if they sold since.
  const closing = new Map(held.map((h) => [h.userId, h.shares]));
  const total = (userId: string) => BigInt(sampled.sums[userId] ?? "0") + (closing.get(userId) ?? 0n);
  const average = new Map<string, number>();
  for (const userId of new Set([...Object.keys(sampled.sums), ...closing.keys()])) average.set(userId, Number(total(userId)) / (samples + 1));
  const backing = await readBacking(store, club.address, n);
  const voices = await voicesFor(store, n, backing.actions.map((a) => a.giver), average, linkedBy, rules);
  const backed = backingPoints(backing.actions, voices, rules);
  const days = await activeDays(store, club.address, n, backing.days);
  const holders: ClosingHolder[] = held.map(({ userId, wallet, wallets, shares, joinedAt }) => {
    const support = backed.get(userId);
    return {
      userId,
      wallet,
      wallets,
      shares: shares.toString(),
      held: total(userId).toString(),
      joinedAt,
      days: days.get(userId) ?? 0,
      backed: support?.points ?? 0,
      backers: support?.backers ?? 0,
      base: support?.base ?? 0,
    };
  });
  const wallets = new Map((await allRows(store, club.address)).flatMap((r) => (r.displayWallet ? [[r.userId, r.displayWallet] as const] : [])));
  const read: BackingRead = { actions: backing.actions, removed: backing.removed, voices, wallets };
  return { holders, days: Object.fromEntries(days), samples, read };
}

/**
 * Turns frozen inputs into Holders: the activity bonus from their active days, backing, swaps and X
 * shares in the epoch's events, and the streak those days make. `streaks` are the Club's, from the
 * epochs built before.
 */
export function scoreHolders(
  inputs: { holders: readonly ClosingHolder[] },
  n: number,
  events: readonly ActivityEvent[],
  reach: ReachRecord | null,
  streaks: Streaks,
  rules: ClubRules = DEFAULT_CLUB_RULES,
): HolderInput[] {
  return inputs.holders.map(({ userId, wallet, wallets, shares, held, joinedAt, days, backed, backers, base }) => {
    const { points, bonusBps, x, swaps, backed: backedPoints } = activityPoints(events, reach, wallets, days, backed, rules);
    return {
      userId,
      wallet,
      wallets,
      shares: BigInt(shares),
      held: BigInt(held),
      bonusBps,
      points,
      xPoints: x,
      swapPoints: swaps,
      backedPoints,
      backers,
      basePoints: base,
      days,
      streak: streakAt(streaks[userId], n, qualifies(days, rules)),
      joinedAt,
    };
  });
}

/**
 * One Club's Holders for epoch `n`, read now and scored: shares from a fresh balance read and the
 * NFTs they held on average over the epoch (the daily samples and this read, ADR 0040), the backing
 * other members gave them (Holders' NFT voices come from the averages; base voices from verified
 * profiles shared by `linkedBy`, epoch ms), the activity bonus from the epoch's events, their active
 * days (posts, likes and replies), and the streak those days make. Also gives every member's active
 * days, so the builder can move streaks along for members without shares too. The live standings
 * use this; the builder scores a frozen `Closing`.
 */
export async function holderInputs(
  store: Store,
  club: ClubEntry,
  n: number,
  events: readonly ActivityEvent[],
  reach: ReachRecord | null,
  holdings: Holdings,
  streaks: Streaks,
  linkedBy: number,
  rules: ClubRules = DEFAULT_CLUB_RULES,
): Promise<{ holders: HolderInput[]; days: Map<string, number>; samples: number }> {
  const inputs = await readInputs(store, club, n, holdings, linkedBy, rules);
  return { holders: scoreHolders(inputs, n, events, reach, streaks, rules), days: new Map(Object.entries(inputs.days)), samples: inputs.samples };
}

/** Freezes one Club's inputs for epoch `n` and keeps them. Throws when balances can't be read. */
async function closeClub(store: Store, club: ClubEntry, n: number, holdings: Holdings, window: { end: number }, rules: ClubRules, now: number): Promise<Closing> {
  const { read, ...inputs } = await readInputs(store, club, n, holdings, verifiedBy(window.end), rules);
  const closing: Closing = { n, closedAt: now, rules, ...inputs, backing: await publishBacking(store, read, read.voices, read.wallets) };
  await store.set(closingKey(club.address, n), closing);
  return closing;
}

export type CloseResult =
  | { status: "closed"; closed: string[]; existing: string[]; failed: string[] }
  /** The epoch hasn't ended yet. */
  | { status: "open"; endsAt: number }
  | { status: "busy" };

/**
 * Freezes every Club's inputs for the finished epoch `n` (ADR 0040), once each: a Club already closed
 * is left alone, and one whose balances can't be read is left for the next run. The close job
 * (`/api/cron/close`) runs it just after an epoch ends; the builder closes any Club that wasn't
 * closed by then, so the build never depends on the job having run.
 */
export async function closeEpoch(store: Store, n: number, deps: RewardsDeps = {}): Promise<CloseResult> {
  const window = epochWindow(n, deps.genesis, deps.length);
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  if (now < window.end) return { status: "open", endsAt: window.end };
  if ((await store.hit(lockKey(), 600)) > 1) return { status: "busy" };
  try {
    const result = { closed: [] as string[], existing: [] as string[], failed: [] as string[] };
    for (const club of deps.clubs ?? registry.clubs()) {
      const key = club.address.toLowerCase();
      if (await store.get<Closing>(closingKey(key, n))) {
        result.existing.push(key);
        continue;
      }
      try {
        await closeClub(store, club, n, deps.holdings ?? viemHoldings, window, await rulesOf(store, deps, key, n), now);
        result.closed.push(key);
      } catch (error) {
        console.error(`closing ${club.symbol} failed:`, error);
        result.failed.push(key);
      }
    }
    return { status: "closed", ...result };
  } finally {
    await store.del(lockKey());
  }
}

const rulesOf = async (store: Store, deps: Pick<RewardsDeps, "rules">, club: string, n: number) => (deps.rules ?? ((c: string, k: number) => rulesFor(store, c, k)))(club, n);

async function compute(
  store: Store,
  n: number,
  window: { start: number; end: number },
  contract: Address,
  deps: RewardsDeps,
  now: number,
): Promise<{ record: EpochRecord; streaks: Map<string, Streaks>; backing: Record<string, PublishedBacking>; ledger: Record<string, PublishedLedger> }> {
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
  const sponsors = sponsorsByClub(await readSponsors(store, n));
  const inputs: ClubInput[] = [];
  const streaks = new Map<string, Streaks>();
  const backing: Record<string, PublishedBacking> = {};
  const closings = new Map<string, Closing>();
  const holdersOf = new Map<string, HolderInput[]>();
  for (const club of clubs) {
    const key = club.address.toLowerCase();
    const carried = (await store.get<{ holders: string; fund: string }>(carryKey(key))) ?? { holders: "0", fund: "0" };
    const prev = await readStreaks(store, key);
    // The inputs frozen when the epoch closed, or frozen now if the close job didn't run (ADR 0040).
    const closing = (await store.get<Closing>(closingKey(key, n))) ?? (await closeClub(store, club, n, holdings, window, await rulesOf(store, deps, key, n), now));
    closings.set(key, closing);
    const { rules, samples } = closing;
    const holders = scoreHolders(closing, n, activity.get(key) ?? [], reach, prev, rules);
    const days = new Map(Object.entries(closing.days));
    holdersOf.set(key, holders);
    backing[key] = closing.backing;
    // Every member's streak moves along, Holder or not: the badge is for posting, the bonus for Holders.
    streaks.set(
      key,
      nextStreaks(
        prev,
        n,
        [...days].filter(([, d]) => qualifies(d, rules)).map(([userId]) => userId),
      ),
    );
    inputs.push({
      club: key,
      fees: fees.get(key) ?? 0n,
      carried: { holders: BigInt(carried.holders), fund: BigInt(carried.fund) },
      sponsored: sponsors.get(key)?.total ?? 0n,
      rules,
      samples,
      holders: holders.map(({ wallet, shares, held, bonusBps, points, days, streak, joinedAt, backedPoints }) => ({
        wallet,
        shares,
        held,
        bonusBps,
        points,
        days,
        streak,
        joinedAt,
        backed: backedPoints,
      })),
      owner: await ownerWallet(store, club),
    });
  }

  const splits = inputs.map(splitClub);
  // The final points of every Holder, paid or not, in leaderboard order.
  const ledger: Record<string, PublishedLedger> = {};
  for (const input of inputs) {
    const closing = closings.get(input.club)!;
    const rules = closing.rules;
    const byWallet = new Map(holdersOf.get(input.club)!.map((h) => [h.wallet.toLowerCase(), h]));
    ledger[input.club] = {
      closedAt: closing.closedAt,
      rules,
      samples: closing.samples,
      rows: rankHolders(input.holders).map((h): LedgerRow => {
        const full = byWallet.get(h.wallet.toLowerCase())!;
        return {
          wallet: h.wallet.toLowerCase(),
          shares: h.shares.toString(),
          held: averageHeld(h.held ?? h.shares, closing.samples),
          points: full.points,
          days: full.days,
          xPoints: full.xPoints,
          swapPoints: full.swapPoints,
          backedPoints: full.backedPoints,
          backers: full.backers,
          basePoints: full.basePoints,
          bonusBps: totalBonusBps(h, rules),
          streak: full.streak,
          paid: paidPlaces([h], rules).length === 1,
        };
      }),
    };
  }
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
      ...(s.sponsored > 0n ? { sponsored: str(s.sponsored), sponsors: sponsors.get(s.club)?.sponsors ?? [] } : {}),
      holderPool: str(s.holderPool),
      fundPool: str(s.fundPool),
      paidHolders: str(s.paidHolders),
      paidFund: str(s.paidFund),
      carry: { holders: str(s.carry.holders), fund: str(s.carry.fund) },
      holderCount: s.holderCount,
      rules: s.rules,
      samples: s.samples,
      closedAt: closings.get(s.club)!.closedAt,
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
        ...(b.held !== undefined ? { held: b.held } : {}),
        ...(b.points !== undefined ? { points: b.points } : {}),
        ...(b.days !== undefined ? { days: b.days } : {}),
        ...(b.streak !== undefined ? { streak: b.streak } : {}),
        ...(b.backed !== undefined ? { backed: b.backed } : {}),
      })),
    })),
    reach,
  };
  return { record, streaks, backing, ledger };
}

/**
 * Each member's shares, from a fresh read of every wallet they've linked: one per NFT of the
 * collection. A Club's memecoin earns the Holder badge but no shares (ADR 0025). Throws when the
 * whole read fails; a single wallet whose balanceOf fails counts as zero.
 */
export async function holderShares(store: Store, club: ClubEntry, holdings: Holdings): Promise<{ userId: string; wallet: string; wallets: string[]; shares: bigint; joinedAt: number }[]> {
  const rows = (await allRows(store, club.address)).filter((r) => r.displayWallet && r.wallets.length > 0);
  if (rows.length === 0) return [];
  const balances = await holdings(
    club.address,
    rows.flatMap((r) => r.wallets as Address[]),
  );
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
  epochs: {
    n: number;
    start: number;
    end: number;
    fees: string;
    sponsored?: string;
    sponsors?: PublishedSponsor[];
    holderPool: string;
    fundPool: string;
    paidHolders: string;
    paidFund: string;
    holderCount: number;
  }[];
  /** What sponsors have added to the running epoch so far (ADR 0035); absent when nothing is sponsored. */
  open?: { n: number; sponsored: string; sponsors: PublishedSponsor[] };
  /** What rolls into the next epoch. */
  carry: { holders: string; fund: string };
  /** The latest epoch's payouts in this Club, largest first, with each Holder's activity bonus. */
  earners: { account: Address; kind: "holder" | "fund"; amount: string; bonusBps?: number; points?: number }[];
};

export async function clubRewards(store: Store, club: string, now = Math.floor(Date.now() / 1000)): Promise<ClubRewardsView> {
  const key = club.toLowerCase();
  const records = await latestEpochs(store, 4);
  const epochs = records.flatMap((r) => {
    const line = r.clubs.find((c) => c.club === key);
    if (!line) return [];
    const { fees, sponsored, sponsors, holderPool, fundPool, paidHolders, paidFund, holderCount } = line;
    return [{ n: r.n, start: r.start, end: r.end, fees, ...(sponsored ? { sponsored, sponsors: sponsors ?? [] } : {}), holderPool, fundPool, paidHolders, paidFund, holderCount }];
  });
  const running = epochAt(now);
  const openLine = running >= 0 ? sponsorsByClub(await readSponsors(store, running)).get(key) : undefined;
  const latest = records[0];
  const earners = (latest?.leaves ?? [])
    .flatMap((l) =>
      l.breakdown
        .filter((b) => b.club === key)
        .map((b) => ({ account: l.account, kind: b.kind, amount: b.amount, ...(b.bonusBps ? { bonusBps: b.bonusBps } : {}), ...(b.points ? { points: b.points } : {}) })),
    )
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0))
    .slice(0, 10);
  const carry = (await store.get<{ holders: string; fund: string }>(carryKey(key))) ?? { holders: "0", fund: "0" };
  return { epochs, ...(openLine ? { open: { n: running, sponsored: openLine.total.toString(), sponsors: openLine.sponsors } } : {}), carry, earners };
}
