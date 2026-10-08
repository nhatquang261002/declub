"use client";

import { useMemo } from "react";
import { getAddress, type Address } from "viem";
import { swapIntents } from "@/lib/contracts";
import { useDeals } from "./useDeals";
import { useIntents } from "./usePool";

/**
 * NFT collections that open deals and signed swaps already use, most used first. With no indexer
 * there is no list of "all collections", but the book itself shows which ones people trade.
 */
export function useMarketCollections(enabled = true): Address[] {
  const deals = useDeals({ limit: 50, enabled });
  const signed = useIntents({ status: "open", enabled: enabled && !!swapIntents });

  return useMemo(() => {
    const counts = new Map<string, number>();
    const add = (assets: readonly { kind: string; token: string }[]) =>
      assets.forEach((a) => {
        if (a.kind === "erc721" || a.kind === "trait") counts.set(getAddress(a.token), (counts.get(getAddress(a.token)) ?? 0) + 1);
      });
    for (const d of deals.deals) if (d.status === "open") add([...d.offered, ...d.requested]);
    for (const row of signed.intents) add([...row.intent.give, ...row.intent.want]);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([address]) => address as Address);
  }, [deals.deals, signed.intents]);
}
