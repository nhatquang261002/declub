import { traitLabel, type TraitFilter } from "./traitRequests";
import { isExpired, type Trade } from "./trades";

export type MonFilter = "any" | "offers-mon" | "wants-mon" | "no-mon";
export type TradeSort = "newest" | "ending-soon";

export type TradeFilters = {
  query: string;
  mon: MonFilter;
  sort: TradeSort;
};

/** Trait lookups for the trades on screen. Both maps are empty until the reads land. */
export type TradeTraitIndex = {
  /** Chog id → its traits, without "None". */
  byId: Map<bigint, TraitFilter[]>;
  /** Trait-request Merkle root (lowercase) → the trait it commits to. */
  byRoot: Map<string, TraitFilter>;
};

export const DEFAULT_FILTERS: TradeFilters = { query: "", mon: "any", sort: "newest" };

export const isFiltering = (f: TradeFilters) =>
  f.query.trim() !== "" || f.mon !== "any" || f.sort !== "newest";

/** Every trait on either side of a trade, including a decoded trait request. */
export function tradeTraits(trade: Trade, index: TradeTraitIndex): TraitFilter[] {
  const out = [...trade.offeredIds, ...trade.requestedIds].flatMap((id) => index.byId.get(id) ?? []);
  const requested = trade.requestedRoot && index.byRoot.get(trade.requestedRoot.toLowerCase());
  if (requested) out.push(requested);
  return out;
}

/** Distinct trait labels ("Hat: Crown") present in `trades`, for search suggestions. */
export function traitSuggestions(trades: Trade[], index: TradeTraitIndex): string[] {
  return [...new Set(trades.flatMap((t) => tradeTraits(t, index)).map(traitLabel))].sort();
}

/**
 * Free-text match. A bare number ("1159" or "#1159") hits the trade id or any Chog id on
 * either side. Anything else matches the maker/taker address or a trait, either as
 * "Hat: Crown" or just the value ("crown").
 */
export function matchesQuery(trade: Trade, query: string, traits?: TradeTraitIndex): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (q === "") return true;
  if (/^\d+$/.test(q)) {
    const n = BigInt(q);
    return (
      trade.id === n || trade.offeredIds.includes(n) || trade.requestedIds.includes(n)
    );
  }
  if (trade.maker.toLowerCase().includes(q) || trade.taker?.toLowerCase().includes(q)) return true;
  return (
    !!traits &&
    tradeTraits(trade, traits).some(
      (t) => traitLabel(t).toLowerCase().includes(q) || t.value.toLowerCase().includes(q),
    )
  );
}

function matchesMon(trade: Trade, mon: MonFilter): boolean {
  switch (mon) {
    case "offers-mon":
      return trade.offeredMon > 0n;
    case "wants-mon":
      return trade.requestedMon > 0n;
    case "no-mon":
      return trade.offeredMon === 0n && trade.requestedMon === 0n;
    default:
      return true;
  }
}

/** Live trades with a deadline first (soonest first), then no-expiry, then the rest. */
function endingSoonRank(trade: Trade, now: number): number {
  if (trade.status !== "open" || isExpired(trade, now)) return 2;
  return trade.expiry === 0n ? 1 : 0;
}

export function applyTradeFilters(
  trades: Trade[],
  filters: TradeFilters,
  now: number,
  traits?: TradeTraitIndex,
): Trade[] {
  const out = trades.filter(
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
