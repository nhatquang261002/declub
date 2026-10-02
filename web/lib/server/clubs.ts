import type { Address } from "viem";
import { completedSwaps, mergeEvents, settlementEvents, summarize, toClubInfo, type ActivityEvent, type ClubDetail, type ClubSummary } from "../clubs";
import type { Settlement } from "../intents";
import { listSettlements } from "../pool";
import { ON_DEAL_INTENTS_ADDRESS } from "../config";
import { clubAssets, type ClubEntry } from "../verifiedAssets";
import { readActivity } from "./activity";
import { holderCount, memberCount } from "./members";
import type { Store } from "./store";

/**
 * What the Club routes serve (docs/09-clubs.md). A Club's activity comes from two places: the log
 * of receipts the server verified (lib/server/activity.ts) and the matcher's settled signed swaps,
 * read when asked, so neither needs the other. Either can be missing, and the Club shows what the
 * other has.
 */
export type Deps = {
  /** The pool's settled cycles that name `token`. Throws when the pool is unreachable. */
  settlements?: (token: Address) => Promise<Settlement[]>;
  now?: () => number;
};

/** How many settled cycles are read per Club. The pool caps one answer at 200. */
const SETTLEMENT_LIMIT = 200;
/** A Club's page asks the pool no more often than this, however many people load it. */
const POOL_TTL_MS = 30_000;

const pooled = new Map<string, { at: number; events: ActivityEvent[] }>();

async function poolEvents(token: Address, deps: Deps): Promise<ActivityEvent[]> {
  if (!ON_DEAL_INTENTS_ADDRESS && !deps.settlements) return [];
  const key = token.toLowerCase();
  const hit = pooled.get(key);
  if (!deps.settlements && hit && Date.now() - hit.at < POOL_TTL_MS) return hit.events;
  try {
    const fetch = deps.settlements ?? ((t: Address) => listSettlements({ token: t, limit: SETTLEMENT_LIMIT }));
    const events = settlementEvents(await fetch(token));
    if (!deps.settlements) pooled.set(key, { at: Date.now(), events });
    return events;
  } catch {
    // A pool that is down only costs the signed swaps: everything else still counts.
    return [];
  }
}

/**
 * Every event known for a Club, newest first. The log keeps one list per Club, under its own
 * asset, whichever of its assets a deal named; the pool is asked about each asset, and a swap
 * that names both counts once.
 */
export async function clubEvents(store: Store | null, club: ClubEntry, deps: Deps = {}): Promise<ActivityEvent[]> {
  const logged = store ? await readActivity(store, club.address).catch(() => []) : [];
  const pooled = await Promise.all(clubAssets(club).map((asset) => poolEvents(asset.address, deps)));
  return mergeEvents(logged, ...pooled);
}

export async function clubList(store: Store | null, entries: readonly ClubEntry[], deps: Deps = {}): Promise<ClubSummary[]> {
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const rows = await Promise.all(
    entries.map(async (entry) => ({
      ...toClubInfo(entry),
      stats: summarize(await clubEvents(store, entry, deps), now),
      members: store ? await memberCount(store, entry.address).catch(() => 0) : 0,
    })),
  );
  // Busiest first; ties keep the list's own order so the page doesn't shuffle.
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.stats.momentum - a.row.stats.momentum || a.i - b.i)
    .map(({ row }) => row);
}

/** How many completed swaps the Market tab lists. */
export const RECENT_LIMIT = 20;

export async function clubDetail(store: Store | null, entry: ClubEntry, deps: Deps = {}): Promise<ClubDetail> {
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const events = await clubEvents(store, entry, deps);
  return {
    club: {
      ...toClubInfo(entry),
      stats: summarize(events, now),
      members: store ? await memberCount(store, entry.address).catch(() => 0) : 0,
    },
    recent: completedSwaps(events, RECENT_LIMIT),
    holders: store ? await holderCount(store, entry.address).catch(() => 0) : 0,
  };
}
