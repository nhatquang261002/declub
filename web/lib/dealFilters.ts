import type { TokenLabel } from "./assets";
import { isExpired, type Deal, type DealStatus } from "./deals";

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

const nativeAmount = (assets: Deal["offered"]) => assets.reduce((sum, a) => (a.kind === "native" ? sum + a.amount : sum), 0n);

/** Native MON has no contract to read a symbol from, so a search matches it by this. */
const NATIVE_SYMBOL = "mon";

/**
 * Free-text match for DeClubEscrow deals. A bare number ("42" or "#42") hits the deal id or any NFT id
 * on either side. Anything else matches the maker / taker, a token or collection address, or its
 * symbol or name (read from the contract, never typed by the maker). "mon" hits a deal with MON on either side.
 */
function matchesQuery(deal: Deal, query: string, info: ReadonlyMap<string, TokenLabel>): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (q === "") return true;
  const assets = [...deal.offered, ...deal.requested];
  if (/^\d+$/.test(q)) {
    const n = BigInt(q);
    return deal.id === n || assets.some((a) => a.kind === "erc721" && a.id === n);
  }
  if (deal.maker.toLowerCase().includes(q) || deal.taker?.toLowerCase().includes(q)) return true;
  return assets.some((a) => {
    if (a.kind === "native") return NATIVE_SYMBOL.includes(q);
    const label = info.get(a.token.toLowerCase());
    return a.token.toLowerCase().includes(q) || (!!label && (label.symbol.toLowerCase().includes(q) || label.name.toLowerCase().includes(q)));
  });
}

function matchesMon(deal: Deal, mon: MonFilter): boolean {
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

/** Free-text query, MON filter and sorting (lib/dealFilters.ts) over DeClubEscrow deals and signed swaps. */
export function applyDealFilters<T extends Deal>(deals: T[], filters: DealFilters, now: number, info: ReadonlyMap<string, TokenLabel>): T[] {
  const out = deals.filter((t) => matchesQuery(t, filters.query, info) && matchesMon(t, filters.mon));
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

const names = (assets: Deal["offered"], token: string) => assets.some((a) => a.kind !== "native" && a.token.toLowerCase() === token.toLowerCase());

/** The deal gives this token away (any id, or any amount). A Club's "Have" list. */
export const offersToken = (deal: Pick<Deal, "offered">, token: string) => names(deal.offered, token);

/** The deal asks for this token, including a trait request for it. A Club's "Wanted" list. */
export const requestsToken = (deal: Pick<Deal, "requested">, token: string) => names(deal.requested, token);

export const involvesToken = (deal: Pick<Deal, "offered" | "requested">, token: string) => offersToken(deal, token) || requestsToken(deal, token);
