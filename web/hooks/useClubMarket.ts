"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { swapIntents } from "@/lib/contracts";
import { MAX_PAGE_SIZE } from "@/lib/dealBook";
import { isExpired } from "@/lib/deals";
import { offersToken, requestsToken } from "@/lib/dealFiltersV2";
import { DEFAULT_FILTERS } from "@/lib/dealFilters";
import type { DealV2 } from "@/lib/dealsV2";
import { intentAsListing } from "@/lib/intents";
import { useDealBook } from "./useDealBook";
import { useIntents } from "./usePool";

/** The most locked deals a Club's market lists, newest first. */
export const MARKET_SIZE = MAX_PAGE_SIZE;

/**
 * What is on offer for a Club's assets right now: the open locked deals that name them, found by
 * the server across the whole book (ADR 0020), and the signed swaps the pool lists for each token.
 * `have` gives an asset away; `wanted` asks for one (a trait request for the collection included).
 * A Club has its own asset and at most one paired with it (lib/verifiedAssets.ts), so there are two
 * pool reads at most.
 */
export function useClubMarket(tokens: readonly [Address, Address?], now: number) {
  const [own, paired] = tokens;
  const { address } = useConnection();
  const deals = useDealBook({
    tab: "open",
    filters: DEFAULT_FILTERS,
    kind: "locked",
    viewer: address,
    tokens: paired ? [own, paired] : [own],
    page: 1,
    size: MARKET_SIZE,
  });
  const signed = useIntents({ status: "open", token: own, enabled: !!swapIntents });
  const signedPaired = useIntents({ status: "open", token: paired, enabled: !!swapIntents && !!paired });

  const { have, wanted } = useMemo(() => {
    const live = (d: DealV2) => d.status === "open" && !isExpired(d, now);
    const intents = [...signed.intents, ...(paired ? signedPaired.intents : [])];
    // A signed swap naming both assets comes back from both reads.
    const unique = [...new Map(intents.map((i) => [i.hash, i])).values()];
    const all = [...unique.map(intentAsListing), ...deals.items].filter(live);
    const mine = [own, ...(paired ? [paired] : [])];
    return {
      have: all.filter((d) => mine.some((t) => offersToken(d, t))),
      wanted: all.filter((d) => mine.some((t) => requestsToken(d, t))),
    };
  }, [deals.items, signed.intents, signedPaired.intents, own, paired, now]);

  return {
    have,
    wanted,
    /** More locked deals name these assets than the `MARKET_SIZE` listed. */
    truncated: deals.total > deals.items.length,
    isLoading: deals.isLoading,
    error: deals.error,
    /** The pool being down only costs the signed swaps. */
    poolError: signed.error ?? signedPaired.error,
  };
}
