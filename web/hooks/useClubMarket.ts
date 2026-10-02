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
 * What is on offer for a Club's assets right now, from the open locked deals among the newest
 * `MARKET_SCAN` and the signed swaps the pool lists for each token. `have` gives an asset away;
 * `wanted` asks for one (a trait request for the collection included). A Club has its own asset
 * and at most one paired with it (lib/verifiedAssets.ts), so there are two pool reads at most.
 */
export function useClubMarket(tokens: readonly [Address, Address?], now: number) {
  const [own, paired] = tokens;
  const deals = useDealsV2({ limit: MARKET_SCAN });
  const signed = useIntents({ status: "open", token: own, enabled: !!swapIntents });
  const signedPaired = useIntents({ status: "open", token: paired, enabled: !!swapIntents && !!paired });

  const { have, wanted } = useMemo(() => {
    const live = (d: DealV2) => d.status === "open" && !isExpired(d, now);
    const intents = [...signed.intents, ...(paired ? signedPaired.intents : [])];
    // A signed swap naming both assets comes back from both reads.
    const unique = [...new Map(intents.map((i) => [i.hash, i])).values()];
    const all = [...unique.map(intentAsListing), ...deals.deals].filter(live);
    const mine = [own, ...(paired ? [paired] : [])];
    return {
      have: all.filter((d) => mine.some((t) => offersToken(d, t))),
      wanted: all.filter((d) => mine.some((t) => requestsToken(d, t))),
    };
  }, [deals.deals, signed.intents, signedPaired.intents, own, paired, now]);

  return {
    have,
    wanted,
    /** Older deals exist that weren't read. */
    truncated: deals.hasMore,
    isLoading: deals.isLoading,
    error: deals.error,
    /** The pool being down only costs the signed swaps. */
    poolError: signed.error ?? signedPaired.error,
  };
}
