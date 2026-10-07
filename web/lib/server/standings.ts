import type { ActivityEvent } from "../clubs";
import { CHAIN_ID, DECLUB_INTENTS_ADDRESS } from "../config";
import { REWARDS, entryGap, epochAt, epochWindow, qualifies, rankHolders, splitClub, type ReachRecord } from "../rewards";
import { clubAssets, registry, type ClubEntry } from "../verifiedAssets";
import { liveStreak, readStreaks, standingsKey, streakAt } from "./streaks";

export { standingsKey };
import { clubEvents } from "./clubs";
import { allRows, viemHoldings, type Holdings } from "./members";
import { readSponsors, sponsorsByClub } from "./sponsors";
import { cachedSettlementFee, carryKey, holderInputs, ownerWallet, reachKey, swapFee, viemSettlementFee } from "./rewards";
import type { Store } from "./store";

/**
 * Live standings (ADR 0032): the running epoch as if it closed now. The same inputs the builder
 * reads (fees so far, a fresh balance read, active days, streaks) through the same split, so a
 * member sees their rank, their bonus and what they'd earn. An estimate: a swap's fee is split
 * between the Clubs its tokens belong to, the balance read is a few minutes old, and anything can
 * change before the epoch closes. Cached per Club for a few minutes, one rebuild at a time.
 */

export const STANDINGS_TTL_SEC = 300;
const lockKey = (club: string) => `declub:rewards:${CHAIN_ID}:standings-lock:${club.toLowerCase()}`;

export type StandingRow = {
  wallet: string;
  /** 1-based, in the order the Holder pool reads them (`rankHolders`): most points first. Only rows with points, up to the paid places, get an estimate. */
  rank: number;
  /** Decimal strings. */
  shares: string;
  joinedAt: number;
  days: number;
  /** Own X shares counted this epoch. */
  xShares: number;
  points: number;
  /** The whole bonus if the epoch closed now: activity plus streak. */
  bonusBps: number;
  /** Qualifying epochs in a row, counting this one if it already qualifies. */
  streak: number;
  /** In wei, for the paid places only. */
  estimate?: string;
};

/** A member's days and streak, Holder or not: what the badge and the nudges read. */
export type MemberActivity = { days: number; streak: number; /** The streak still alive from earlier epochs, kept if this one qualifies. */ carried: number };

export type ClubStandings = {
  club: string;
  n: number;
  start: number;
  endsAt: number;
  /** Unix seconds. */
  computedAt: number;
  fees: string;
  /** What sponsors have added to the Holder pool so far (ADR 0035); absent in copies cached before. */
  sponsored?: string;
  holderPool: string;
  fundPool: string;
  rows: StandingRow[];
  /** By display wallet, lowercase: every member with active days or a live streak. */
  activity: Record<string, MemberActivity>;
};

export type StandingsDeps = {
  /** Unix seconds. */
  now?: () => number;
  clubs?: readonly ClubEntry[];
  events?: (club: ClubEntry) => Promise<ActivityEvent[]>;
  holdings?: Holdings;
  settlementFee?: (txHash: `0x${string}`) => Promise<bigint>;
  intents?: string;
  genesis?: number;
  length?: number;
};

/** Works out a Club's standings now. Throws when balances can't be read. */
export async function computeStandings(store: Store, club: ClubEntry, deps: StandingsDeps = {}): Promise<ClubStandings | null> {
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const n = epochAt(now, deps.genesis, deps.length);
  if (n < 0) return null;
  const window = epochWindow(n, deps.genesis, deps.length);
  const key = club.address.toLowerCase();
  const clubs = deps.clubs ?? registry.clubs();
  const settlementFee = cachedSettlementFee(store, deps.settlementFee ?? viemSettlementFee);
  const intents = (deps.intents ?? DECLUB_INTENTS_ADDRESS ?? "").toLowerCase();

  const events = (await (deps.events ?? ((c: ClubEntry) => clubEvents(store, c)))(club)).filter((e) => e.at >= window.start && e.at < window.end);
  let fees = 0n;
  for (const event of events) {
    if (event.kind !== "swapped") continue;
    const named = clubs.filter((c) => clubAssets(c).some((a) => event.tokens.includes(a.address.toLowerCase()))).length;
    fees += (await swapFee(event, intents, settlementFee)) / BigInt(Math.max(1, named));
  }

  const reach = await store.get<ReachRecord>(reachKey(n));
  const streaks = await readStreaks(store, key);
  const { holders, days } = await holderInputs(store, club, n, events, reach, deps.holdings ?? viemHoldings, streaks);
  const carried = (await store.get<{ holders: string; fund: string }>(carryKey(key))) ?? { holders: "0", fund: "0" };
  const sponsored = sponsorsByClub(await readSponsors(store, n)).get(key)?.total ?? 0n;
  const split = splitClub({
    club: key,
    fees,
    sponsored,
    carried: { holders: BigInt(carried.holders), fund: BigInt(carried.fund) },
    holders,
    owner: await ownerWallet(store, club),
  });
  const paid = new Map(split.payouts.filter((p) => p.kind === "holder").map((p) => [p.wallet, p]));

  const rows = rankHolders(holders).map((h, i): StandingRow => {
    const own = new Set(h.wallets.map((w) => w.toLowerCase()));
    const payout = paid.get(h.wallet.toLowerCase());
    return {
      wallet: h.wallet.toLowerCase(),
      rank: i + 1,
      shares: h.shares.toString(),
      joinedAt: h.joinedAt,
      days: h.days,
      xShares: events.filter((e) => e.kind === "xshare" && own.has(e.parties[0] ?? "")).length,
      points: h.points,
      bonusBps: payout?.bonusBps ?? 0,
      streak: h.streak,
      ...(payout ? { estimate: payout.amount.toString() } : {}),
    };
  });

  const activity: Record<string, MemberActivity> = {};
  for (const row of await allRows(store, key)) {
    if (!row.displayWallet) continue;
    const d = days.get(row.userId) ?? 0;
    const alive = liveStreak(streaks[row.userId], n);
    if (d === 0 && alive === 0) continue;
    activity[row.displayWallet.toLowerCase()] = { days: d, streak: streakAt(streaks[row.userId], n, qualifies(d)), carried: alive };
  }

  return {
    club: key,
    n,
    start: window.start,
    endsAt: window.end,
    computedAt: now,
    fees: fees.toString(),
    sponsored: sponsored.toString(),
    holderPool: split.holderPool.toString(),
    fundPool: split.fundPool.toString(),
    rows,
    activity,
  };
}

/**
 * A Club's standings, from the cache while it's fresh and for the running epoch. One request
 * rebuilds at a time; the others, and a failed balance read, get the last copy (or null).
 */
export async function clubStandings(store: Store, club: ClubEntry, deps: StandingsDeps = {}): Promise<ClubStandings | null> {
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const cached = await store.get<ClubStandings>(standingsKey(club.address));
  const n = epochAt(now, deps.genesis, deps.length);
  if (cached && cached.n === n && now - cached.computedAt < STANDINGS_TTL_SEC) return cached;
  if ((await store.hit(lockKey(club.address), 60)) > 1) return cached?.n === n ? cached : null;
  try {
    const fresh = await computeStandings(store, club, { ...deps, now: () => now });
    if (fresh) await store.set(standingsKey(club.address), fresh);
    return fresh;
  } catch (error) {
    console.error(`standings for ${club.symbol} failed:`, error);
    return cached?.n === n ? cached : null;
  } finally {
    await store.del(lockKey(club.address));
  }
}

/** How many rows the route serves: the paid places and a few below the cut line. */
export const ROWS_SHOWN = REWARDS.maxHolders + 15;

/** What one reader is shown: the top rows, and their own place if they gave a wallet. */
export type StandingsView = Omit<ClubStandings, "rows" | "activity"> & {
  rows: StandingRow[];
  holders: number;
  me: (StandingRow & { gap: string; activity: MemberActivity | null }) | { rank: null; activity: MemberActivity | null } | null;
};

export function standingsView(standings: ClubStandings, wallet?: string): StandingsView {
  const { rows, activity, ...rest } = standings;
  let me: StandingsView["me"] = null;
  if (wallet) {
    const w = wallet.toLowerCase();
    const row = rows.find((r) => r.wallet === w);
    const mine = activity[w] ?? null;
    if (row) {
      const gap = entryGap(rows.map((r) => ({ wallet: r.wallet, shares: BigInt(r.shares), points: r.points, joinedAt: r.joinedAt })), w) ?? 0;
      me = { ...row, gap: String(gap), activity: mine };
    } else {
      me = { rank: null, activity: mine };
    }
  }
  return { ...rest, rows: rows.slice(0, ROWS_SHOWN), holders: rows.length, me };
}
