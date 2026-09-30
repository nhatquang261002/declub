import { traitLabel, type TraitFilter } from "./traitRequests";
import { isExpired, type Deal } from "./deals";

export type MonFilter = "any" | "offers-mon" | "wants-mon" | "no-mon";
export type DealSort = "newest" | "ending-soon";

export type DealFilters = {
  query: string;
  mon: MonFilter;
  sort: DealSort;
};

/** Trait lookups for the deals on screen. Both maps are empty until the reads land. */
export type DealTraitIndex = {
  /** Chog id → its traits, without "None". */
  byId: Map<bigint, TraitFilter[]>;
  /** Trait-request Merkle root (lowercase) → the trait it commits to. */
  byRoot: Map<string, TraitFilter>;
};

export const DEFAULT_FILTERS: DealFilters = { query: "", mon: "any", sort: "newest" };

export const isFiltering = (f: DealFilters) =>
  f.query.trim() !== "" || f.mon !== "any" || f.sort !== "newest";

/** Every trait on either side of a deal, including a decoded trait request. */
export function dealTraits(deal: Deal, index: DealTraitIndex): TraitFilter[] {
  const out = [...deal.offeredIds, ...deal.requestedIds].flatMap((id) => index.byId.get(id) ?? []);
  const requested = deal.requestedRoot && index.byRoot.get(deal.requestedRoot.toLowerCase());
  if (requested) out.push(requested);
  return out;
}

/** Distinct trait labels ("Hat: Crown") present in `deals`, for search suggestions. */
export function traitSuggestions(deals: Deal[], index: DealTraitIndex): string[] {
  return [...new Set(deals.flatMap((t) => dealTraits(t, index)).map(traitLabel))].sort();
}

/**
 * Free-text match. A bare number ("1159" or "#1159") hits the deal id or any Chog id on
 * either side. Anything else matches the maker/taker address or a trait, either as
 * "Hat: Crown" or just the value ("crown").
 */
export function matchesQuery(deal: Deal, query: string, traits?: DealTraitIndex): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (q === "") return true;
  if (/^\d+$/.test(q)) {
    const n = BigInt(q);
    return (
      deal.id === n || deal.offeredIds.includes(n) || deal.requestedIds.includes(n)
    );
  }
  if (deal.maker.toLowerCase().includes(q) || deal.taker?.toLowerCase().includes(q)) return true;
  return (
    !!traits &&
    dealTraits(deal, traits).some(
      (t) => traitLabel(t).toLowerCase().includes(q) || t.value.toLowerCase().includes(q),
    )
  );
}

function matchesMon(deal: Deal, mon: MonFilter): boolean {
  switch (mon) {
    case "offers-mon":
      return deal.offeredMon > 0n;
    case "wants-mon":
      return deal.requestedMon > 0n;
    case "no-mon":
      return deal.offeredMon === 0n && deal.requestedMon === 0n;
    default:
      return true;
  }
}

/** Live deals with a deadline first (soonest first), then no-expiry, then the rest. */
export function endingSoonRank(deal: Pick<Deal, "status" | "expiry">, now: number): number {
  if (deal.status !== "open" || isExpired(deal, now)) return 2;
  return deal.expiry === 0n ? 1 : 0;
}

export function applyDealFilters(
  deals: Deal[],
  filters: DealFilters,
  now: number,
  traits?: DealTraitIndex,
): Deal[] {
  const out = deals.filter(
    (t) => matchesQuery(t, filters.query, traits) && matchesMon(t, filters.mon),
  );
  if (filters.sort === "ending-soon") {
    out.sort((a, b) => {
      const rank = endingSoonRank(a, now) - endingSoonRank(b, now);
      if (rank !== 0) return rank;
      if (a.expiry !== b.expiry && endingSoonRank(a, now) === 0) return a.expiry < b.expiry ? -1 : 1;
      return a.id < b.id ? 1 : -1;
    });
  }
  return out;
}
