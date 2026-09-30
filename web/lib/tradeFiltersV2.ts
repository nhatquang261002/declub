import type { TokenInfo } from "./assets";
import { endingSoonRank, type MonFilter, type TradeFilters } from "./tradeFilters";
import type { TradeV2 } from "./tradesV2";

const nativeAmount = (assets: TradeV2["offered"]) =>
  assets.reduce((sum, a) => (a.kind === "native" ? sum + a.amount : sum), 0n);

/**
 * Free-text match for V2 trades. A bare number ("42" or "#42") hits the trade id or any NFT id
 * on either side. Anything else matches the maker / taker, a token address, or a token symbol
 * (read from the token, never typed by the maker).
 */
export function matchesQueryV2(
  trade: TradeV2,
  query: string,
  info: ReadonlyMap<string, TokenInfo>,
): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (q === "") return true;
  const assets = [...trade.offered, ...trade.requested];
  if (/^\d+$/.test(q)) {
    const n = BigInt(q);
    return trade.id === n || assets.some((a) => a.kind === "erc721" && a.id === n);
  }
  if (trade.maker.toLowerCase().includes(q) || trade.taker?.toLowerCase().includes(q)) return true;
  return assets.some(
    (a) =>
      a.kind !== "native" &&
      (a.token.toLowerCase().includes(q) ||
        info.get(a.token.toLowerCase())?.symbol.toLowerCase().includes(q)),
  );
}

function matchesMon(trade: TradeV2, mon: MonFilter): boolean {
  const offered = nativeAmount(trade.offered) > 0n;
  const requested = nativeAmount(trade.requested) > 0n;
  switch (mon) {
    case "offers-mon":
      return offered;
    case "wants-mon":
      return requested;
    case "no-mon":
      return !offered && !requested;
    default:
      return true;
  }
}

/** Same query, MON filter and sorting as `applyTradeFilters`, for V2 trades. */
export function applyTradeFiltersV2(
  trades: TradeV2[],
  filters: TradeFilters,
  now: number,
  info: ReadonlyMap<string, TokenInfo>,
): TradeV2[] {
  const out = trades.filter(
    (t) => matchesQueryV2(t, filters.query, info) && matchesMon(t, filters.mon),
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
