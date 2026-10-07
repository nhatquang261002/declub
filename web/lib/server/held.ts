import { CHAIN_ID } from "../config";
import { epochAt } from "../rewards";
import type { ClubEntry } from "../verifiedAssets";
import { dayOf } from "./activeDays";
import { holderShares } from "./rewards";
import type { Holdings } from "./members";
import type { Store } from "./store";

/**
 * Holdings averaged over the epoch (ADR 0040). Buying or borrowing NFTs just before close would
 * otherwise get a full voice and a full share of the pool, so once a UTC day each Club's members'
 * NFTs are read and added to the epoch's running totals. The builder adds the read at close and
 * divides by the number of reads, so a week of holding counts for seven times a purchase on the
 * last day. A day before someone joined counts as zero.
 */

/** The days sampled in a Club's epoch (UTC day numbers) and each member's NFTs on them, added up, by user id. */
export type Held = { days: number[]; sums: Record<string, string> };

export const heldKey = (club: string, n: number) => `declub:held:${CHAIN_ID}:${club.toLowerCase()}:${n}`;
const lockKey = (club: string, day: number) => `declub:held-lock:${CHAIN_ID}:${club.toLowerCase()}:${day}`;

export async function readHeld(store: Store, club: string, n: number): Promise<Held> {
  return (await store.get<Held>(heldKey(club, n))) ?? { days: [], sums: {} };
}

export type SampleResult = { sampled: string[]; skipped: string[]; failed: string[] };

/**
 * Reads every Club's members' NFTs and adds them to the running epoch's totals, once per Club per
 * UTC day: a Club already sampled today is skipped, so the job can run as often as it likes. A Club
 * whose balances can't be read is left for the next run.
 */
export async function sampleHoldings(
  store: Store,
  clubs: readonly ClubEntry[],
  holdings: Holdings,
  now: number,
  epochs: { genesis?: number; length?: number } = {},
): Promise<SampleResult> {
  const result: SampleResult = { sampled: [], skipped: [], failed: [] };
  const n = epochAt(now, epochs.genesis, epochs.length);
  if (n < 0) return result;
  const day = dayOf(now);
  for (const club of clubs) {
    const key = club.address.toLowerCase();
    const known = await readHeld(store, key, n);
    if (known.days.includes(day)) {
      result.skipped.push(key);
      continue;
    }
    // Two runs at once would add the same day twice.
    if ((await store.hit(lockKey(key, day), 120)) > 1) {
      result.skipped.push(key);
      continue;
    }
    try {
      const fresh = await readHeld(store, key, n);
      if (fresh.days.includes(day)) {
        result.skipped.push(key);
        continue;
      }
      const sums = { ...fresh.sums };
      for (const h of await holderShares(store, club, holdings)) sums[h.userId] = (BigInt(sums[h.userId] ?? "0") + h.shares).toString();
      await store.set(heldKey(key, n), { days: [...fresh.days, day], sums } satisfies Held);
      result.sampled.push(key);
    } catch (error) {
      console.error(`sampling ${club.symbol} holdings failed:`, error);
      result.failed.push(key);
    } finally {
      await store.del(lockKey(key, day));
    }
  }
  return result;
}
