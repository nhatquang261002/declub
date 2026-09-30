"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { swapV2 } from "@/lib/contracts";
import { toTradeV2 } from "@/lib/tradesV2";

/** One ChogSwapV2 trade by id. `trade` is null for an id that doesn't exist. */
export function useTradeV2(id: bigint) {
  const result = useReadContract({
    ...swapV2!,
    functionName: "getTrade",
    args: [id],
    query: { enabled: !!swapV2, refetchInterval: 6_000 },
  });
  const trade = useMemo(() => (result.data ? toTradeV2(id, result.data) : null), [result.data, id]);
  return { trade, isLoading: !!swapV2 && result.isLoading, error: result.error };
}
