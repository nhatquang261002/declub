import type { ActivityEvent } from "../clubs";
import { CHAIN_ID, DECLUB_INTENTS_ADDRESS } from "../config";
import { PROTOCOL, averageHeld, entryGap, rampGap, rankMembers, epochAt, epochWindow, qualifies, rankHolders, splitClub, type ClubRules, type ReachRecord } from "../rewards";
import { clubAssets, registry, type ClubEntry } from "../verifiedAssets";
import { liveStreak, readStreaks, standingsKey, streakAt } from "./streaks";

export { standingsKey };
import { settleDue } from "./challenges";
import { rulesFor } from "./clubRules";
import { clubEvents } from "./clubs";
import { allRows, viemHoldings, type Holdings } from "./members";
import { readSponsors, sponsorsByClub } from "./sponsors";
import { cachedSettlementFee, carryKey, holderInputs, ownerWallet, reachKey, swapFee, verifiedBy, viemSettlementFee } from "./rewards";
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
  /** 1-based, in leaderboard order (`rankHolders`, or `rankMembers` for members without NFTs): most points first. Only rows that would be paid get an estimate. */
  rank: number;
  /** Decimal strings. */
  shares: string;
  /** The NFTs held on average over the epoch so far (ADR 0040), 2 decimals: what the voice and the share of the pool count. Absent in copies cached before. */
  held?: number;
  joinedAt: number;
  days: number;
  /** Own X shares counted this epoch. */
  xShares: number;
  /** Activity points: days on the Board, X shares and swaps together (ADR 0037 ranks by it). */
  points: number;
  /** Of `points`: from X shares, from swaps, and from others' backing (ADR 0038); the rest is from active days. Absent in copies cached before. */
  xPoints?: number;
  swapPoints?: number;
  backedPoints?: number;
  /** Of `points`: won in the Club's challenges this epoch (ADR 0045). */
  challengePoints?: number;
  /** How many members backed them this epoch. */
  backers?: number;
  /** Of `backedPoints`: from verified accounts' base voices (ADR 0039). */
  basePoints?: number;
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
  /** The Club's rules for this epoch (ADR 0040). Absent in copies cached before: the defaults. */
  rules?: ClubRules;
  /** How many Holders, and members without NFTs (ADR 0044), would be paid if the epoch closed now. */
  paid?: number;
  paidMembers?: number;
  /** Members without NFTs ranked for the Club's slice, when it pays them (ADR 0044). */
  members?: StandingRow[];
  /** Club wallets banned from rewards (ADR 0044). */
  excluded?: string[];
  /** Daily holdings samples so far; `held` averages them with the read just made. */
  samples?: number;
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
  /** A Club's rules for epoch `n`. Defaults to `rulesFor`; tests give their own. */
  rules?: (club: string, n: number) => Promise<ClubRules> | ClubRules;
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

  // Challenges that have ended count in the standings, so settle them first (ADR 0045).
  await settleDue(store, club, { now: () => now * 1000, ...(deps.genesis !== undefined && deps.length !== undefined ? { epochs: { genesis: deps.genesis, length: deps.length } } : {}) });
  const events = (await (deps.events ?? ((c: ClubEntry) => clubEvents(store, c)))(club)).filter((e) => e.at >= window.start && e.at < window.end);
  let fees = 0n;
  for (const event of events) {
    if (event.kind !== "swapped") continue;
    const named = clubs.filter((c) => clubAssets(c).some((a) => event.tokens.includes(a.address.toLowerCase()))).length;
    fees += (await swapFee(event, intents, settlementFee)) / BigInt(Math.max(1, named));
  }

  const reach = await store.get<ReachRecord>(reachKey(n));
  const streaks = await readStreaks(store, key);
  const rules = await (deps.rules ?? ((c: string, k: number) => rulesFor(store, c, k)))(key, n);
  const { holders, members, excluded, days, samples } = await holderInputs(store, club, n, events, reach, deps.holdings ?? viemHoldings, streaks, verifiedBy(window.end), rules);
  const carried = (await store.get<{ holders: string; fund: string }>(carryKey(key))) ?? { holders: "0", fund: "0" };
  const sponsored = sponsorsByClub(await readSponsors(store, n)).get(key)?.total ?? 0n;
  const split = splitClub({
    club: key,
    fees,
    sponsored,
    carried: { holders: BigInt(carried.holders), fund: BigInt(carried.fund) },
    holders,
    ...(rules.nonHolderBps > 0 ? { members } : {}),
    owner: await ownerWallet(store, club),
    rules,
    samples,
  });
  const paid = new Map(split.payouts.filter((p) => p.kind !== "fund").map((p) => [p.wallet, p]));

  const rowOf = (h: (typeof holders)[number], i: number): StandingRow => {
    const own = new Set(h.wallets.map((w) => w.toLowerCase()));
    const payout = paid.get(h.wallet.toLowerCase());
    return {
      wallet: h.wallet.toLowerCase(),
      rank: i + 1,
      shares: h.shares.toString(),
      ...(h.held !== undefined ? { held: averageHeld(h.held, samples) } : {}),
      joinedAt: h.joinedAt,
      days: h.days,
      xShares: events.filter((e) => e.kind === "xshare" && own.has(e.parties[0] ?? "")).length,
      points: h.points,
      xPoints: h.xPoints,
      swapPoints: h.swapPoints,
      backedPoints: h.backedPoints,
      ...(h.challengePoints ? { challengePoints: h.challengePoints } : {}),
      backers: h.backers,
      basePoints: h.basePoints,
      bonusBps: payout?.bonusBps ?? 0,
      streak: h.streak,
      ...(payout ? { estimate: payout.amount.toString() } : {}),
    };
  };
  const rows = rankHolders(holders).map(rowOf);
  const memberRows = rules.nonHolderBps > 0 ? rankMembers(members).map(rowOf) : [];

  const activity: Record<string, MemberActivity> = {};
  for (const row of await allRows(store, key)) {
    if (!row.displayWallet) continue;
    const d = days.get(row.userId) ?? 0;
    const alive = liveStreak(streaks[row.userId], n);
    if (d === 0 && alive === 0) continue;
    activity[row.displayWallet.toLowerCase()] = { days: d, streak: streakAt(streaks[row.userId], n, qualifies(d, rules)), carried: alive };
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
    rules,
    paid: split.holderCount,
    ...(rules.nonHolderBps > 0 ? { paidMembers: split.memberCount, members: memberRows } : {}),
    ...(excluded.length ? { excluded } : {}),
    samples,
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

/** How many rows the route serves: the leaderboard's top, and as many of the members without NFTs. */
export const ROWS_SHOWN = 25;

/** What one reader is shown: the top rows, and their own place if they gave a wallet. */
export type StandingsView = Omit<ClubStandings, "rows" | "activity"> & {
  rows: StandingRow[];
  holders: number;
  me:
    | (StandingRow & {
        /** Points to be paid at all, and to be paid a whole share (the rest of the ramp, ADR 0044). */
        gap: string;
        toFull: string;
        /** A Holder's row, or a member without NFTs' row in the Club's slice. */
        holder: boolean;
        activity: MemberActivity | null;
      })
    | { rank: null; activity: MemberActivity | null; excluded?: true }
    | null;
};

export function standingsView(standings: ClubStandings, wallet?: string): StandingsView {
  const { rows, activity, members, ...rest } = standings;
  let me: StandingsView["me"] = null;
  if (wallet) {
    const w = wallet.toLowerCase();
    const mine = activity[w] ?? null;
    const row = rows.find((r) => r.wallet === w);
    const memberRow = members?.find((r) => r.wallet === w);
    if (row) {
      const gap =
        entryGap(
          rows.map((r) => ({ wallet: r.wallet, shares: BigInt(r.shares), points: r.points, joinedAt: r.joinedAt })),
          w,
          rest.rules,
        ) ?? 0;
      me = { ...row, gap: String(gap), toFull: String(rampGap(row.points, rest.rules)), holder: true, activity: mine };
    } else if (memberRow) {
      const gap = Math.max(0, PROTOCOL.minPaidPoints - memberRow.points);
      me = { ...memberRow, gap: String(gap), toFull: "0", holder: false, activity: mine };
    } else {
      me = { rank: null, activity: mine, ...(rest.excluded?.includes(w) ? { excluded: true as const } : {}) };
    }
  }
  return { ...rest, rows: rows.slice(0, ROWS_SHOWN), ...(members ? { members: members.slice(0, ROWS_SHOWN) } : {}), holders: rows.length, me };
}
