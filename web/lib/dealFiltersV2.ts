import type { TokenInfo } from "./assets";
import { endingSoonRank, type MonFilter, type DealFilters } from "./dealFilters";
import type { DealV2 } from "./dealsV2";

const nativeAmount = (assets: DealV2["offered"]) =>
  assets.reduce((sum, a) => (a.kind === "native" ? sum + a.amount : sum), 0n);

/**
 * Free-text match for V2 deals. A bare number ("42" or "#42") hits the deal id or any NFT id
 * on either side. Anything else matches the maker / taker, a token address, or a token symbol
 * (read from the token, never typed by the maker).
 */
export function matchesQueryV2(
  deal: DealV2,
  query: string,
  info: ReadonlyMap<string, TokenInfo>,
): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (q === "") return true;
  const assets = [...deal.offered, ...deal.requested];
  if (/^\d+$/.test(q)) {
    const n = BigInt(q);
    return deal.id === n || assets.some((a) => a.kind === "erc721" && a.id === n);
  }
  if (deal.maker.toLowerCase().includes(q) || deal.taker?.toLowerCase().includes(q)) return true;
  return assets.some(
    (a) =>
      a.kind !== "native" &&
      (a.token.toLowerCase().includes(q) ||
        info.get(a.token.toLowerCase())?.symbol.toLowerCase().includes(q)),
  );
}

function matchesMon(deal: DealV2, mon: MonFilter): boolean {
  const offered = nativeAmount(deal.offered) > 0n;
  const requested = nativeAmount(deal.requested) > 0n;
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

/** Same query, MON filter and sorting as `applyDealFilters`, for V2 deals. */
export function applyDealFiltersV2<T extends DealV2>(
  deals: T[],
  filters: DealFilters,
  now: number,
  info: ReadonlyMap<string, TokenInfo>,
): T[] {
  const out = deals.filter(
    (t) => matchesQueryV2(t, filters.query, info) && matchesMon(t, filters.mon),
  );
  if (filters.sort === "ending-soon") {
    out.sort((a, b) => {
      const rank = endingSoonRank(a, now) - endingSoonRank(b, now);
      if (rank !== 0) return rank;
      if (a.expiry !== b.expiry && endingSoonRank(a, now) === 0) return a.expiry < b.expiry ? -1 : 1;
      return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
    });
  }
  return out;
}

const names = (assets: DealV2["offered"], token: string) =>
  assets.some((a) => a.kind !== "native" && a.token.toLowerCase() === token.toLowerCase());

/** The deal gives this token away (any id, or any amount). A Club's "Have" list. */
export const offersToken = (deal: Pick<DealV2, "offered">, token: string) => names(deal.offered, token);

/** The deal asks for this token, including a trait request for it. A Club's "Wanted" list. */
export const requestsToken = (deal: Pick<DealV2, "requested">, token: string) => names(deal.requested, token);

export const involvesToken = (deal: Pick<DealV2, "offered" | "requested">, token: string) =>
  offersToken(deal, token) || requestsToken(deal, token);
