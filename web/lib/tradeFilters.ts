import { isExpired, type Trade } from "./trades";

export type MonFilter = "any" | "offers-mon" | "wants-mon" | "chogs-only";
export type TradeSort = "newest" | "ending-soon";

export type TradeFilters = {
  query: string;
  mon: MonFilter;
  sort: TradeSort;
};

export const DEFAULT_FILTERS: TradeFilters = { query: "", mon: "any", sort: "newest" };

export const isFiltering = (f: TradeFilters) =>
  f.query.trim() !== "" || f.mon !== "any" || f.sort !== "newest";

/**
 * Free-text match. A bare number ("1159" or "#1159") hits the trade id or any Chog id on
 * either side; anything else is matched against the maker and taker addresses.
 */
export function matchesQuery(trade: Trade, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (q === "") return true;
  if (/^\d+$/.test(q)) {
    const n = BigInt(q);
    return (
      trade.id === n || trade.offeredIds.includes(n) || trade.requestedIds.includes(n)
    );
  }
  return trade.maker.toLowerCase().includes(q) || !!trade.taker?.toLowerCase().includes(q);
}

function matchesMon(trade: Trade, mon: MonFilter): boolean {
  switch (mon) {
    case "offers-mon":
      return trade.offeredMon > 0n;
    case "wants-mon":
      return trade.requestedMon > 0n;
    case "chogs-only":
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

export function applyTradeFilters(trades: Trade[], filters: TradeFilters, now: number): Trade[] {
  const out = trades.filter(
    (t) => matchesQuery(t, filters.query) && matchesMon(t, filters.mon),
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
