"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { swapIntents } from "@/lib/contracts";
import { isExpired } from "@/lib/deals";
import { offersToken, requestsToken } from "@/lib/dealFiltersV2";
import type { DealV2 } from "@/lib/dealsV2";
import { intentAsListing } from "@/lib/intents";
import { useDealsV2 } from "./useDealsV2";
import { useIntents } from "./usePool";

/** How many of the newest deals are read: there is no way to ask the chain for one asset's deals. */
export const MARKET_SCAN = 200;

/**
 * What is on offer for a Club's asset right now, from the open locked deals among the newest
 * `MARKET_SCAN` and the signed swaps the pool lists for the token. `have` gives the asset away;
 * `wanted` asks for it (a trait request for the collection included).
 */
export function useClubMarket(token: Address, now: number) {
  const deals = useDealsV2({ limit: MARKET_SCAN });
  const signed = useIntents({ status: "open", token, enabled: !!swapIntents });

  const { have, wanted } = useMemo(() => {
    const live = (d: DealV2) => d.status === "open" && !isExpired(d, now);
    const all = [...signed.intents.map(intentAsListing), ...deals.deals].filter(live);
    return {
      have: all.filter((d) => offersToken(d, token)),
      wanted: all.filter((d) => requestsToken(d, token)),
    };
  }, [deals.deals, signed.intents, token, now]);

  return {
    have,
    wanted,
    /** Older deals exist that weren't read. */
    truncated: deals.hasMore,
    isLoading: deals.isLoading,
    error: deals.error,
    /** The pool being down only costs the signed swaps. */
    poolError: signed.error,
  };
}
