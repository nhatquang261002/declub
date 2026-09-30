"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { swapV2 } from "@/lib/contracts";
import { toDealV2, type DealV2 } from "@/lib/dealsV2";

/**
 * The newest `limit` ChogSwapV2 deals, newest first. Same approach as `useDeals` (ADR 0004):
 * `tradeCount` then one multicall of `getTrade`, because the public RPC can't scan logs.
 * Returns nothing while V2 isn't configured.
 */
export function useDealsV2({ limit = 200, enabled = true }: { limit?: number; enabled?: boolean } = {}) {
  const active = enabled && !!swapV2;
  const count = useReadContract({
    ...swapV2!,
    functionName: "tradeCount",
    query: { enabled: active, refetchInterval: 5_000 },
  });
  const total = count.data ?? 0n;

  const ids = useMemo(() => {
    const out: bigint[] = [];
    for (let id = total; id >= 1n && out.length < limit; id--) out.push(id);
    return out;
  }, [total, limit]);

  const results = useReadContracts({
    contracts: ids.map((id) => ({ ...swapV2!, functionName: "getTrade", args: [id] }) as const),
    query: {
      enabled: active && ids.length > 0,
      refetchInterval: 8_000,
      placeholderData: (previous) => previous,
    },
  });

  const deals = useMemo(() => {
    const out: DealV2[] = [];
    results.data?.forEach((r, i) => {
      if (r.status !== "success" || ids[i] === undefined) return;
      const deal = toDealV2(ids[i], r.result);
      if (deal) out.push(deal);
    });
    return out;
  }, [results.data, ids]);

  return {
    enabled: active,
    deals,
    total,
    hasMore: BigInt(deals.length) < total,
    isLoading: active && (count.isLoading || (ids.length > 0 && results.isLoading)),
    error: count.error ?? results.error,
  };
}
