import { isExpired, type DealStatus } from "./deals";

export type MonFilter = "any" | "offers-mon" | "wants-mon" | "no-mon";
export type DealSort = "newest" | "ending-soon";

export type DealFilters = {
  query: string;
  mon: MonFilter;
  sort: DealSort;
};

export const DEFAULT_FILTERS: DealFilters = { query: "", mon: "any", sort: "newest" };

export const isFiltering = (f: DealFilters) => f.query.trim() !== "" || f.mon !== "any" || f.sort !== "newest";

/** Live deals with a deadline first (soonest first), then no-expiry, then the rest. */
export function endingSoonRank(deal: { status: DealStatus; expiry: bigint }, now: number): number {
  if (deal.status !== "open" || isExpired(deal, now)) return 2;
  return deal.expiry === 0n ? 1 : 0;
}
