"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { swap } from "@/lib/contracts";
import { DEMO_TRADES } from "@/lib/config";
import { demoTrades, toTrade, type Trade } from "@/lib/trades";

/**
 * The newest `limit` trades, newest first.
 *
 * Trade ids are sequential (1..tradeCount) and `getTrade` returns the full terms, so this
 * reads storage with one multicall instead of scanning `TradeCreated` logs. The public
 * Monad RPC caps eth_getLogs at 100 blocks, which rules out a scan from the deploy block.
 */
export function useTrades({ limit = 200, enabled = true }: { limit?: number; enabled?: boolean } = {}) {
  const count = useReadContract({
    ...swap,
    functionName: "tradeCount",
    query: { enabled, refetchInterval: 5_000 },
  });
  const total = count.data ?? 0n;
  const showDemoTrades = DEMO_TRADES;

  const ids = useMemo(() => {
    const out: bigint[] = [];
    for (let id = total; id >= 1n && out.length < limit; id--) out.push(id);
    return out;
  }, [total, limit]);

  const results = useReadContracts({
    contracts: ids.map((id) => ({ ...swap, functionName: "getTrade", args: [id] }) as const),
    query: {
      enabled: ids.length > 0,
      refetchInterval: 8_000,
      // Keep showing the old list while a new tradeCount's batch loads.
      placeholderData: (previous) => previous,
    },
  });
  const traitResults = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...swap, functionName: "requestedRoot", args: [id] },
      { ...swap, functionName: "requestedCount", args: [id] },
    ]),
    query: { enabled: ids.length > 0, refetchInterval: 8_000 },
  });

  const trades = useMemo(() => {
    if (showDemoTrades) return demoTrades();
    const out: Trade[] = [];
    results.data?.forEach((r, i) => {
      if (r.status !== "success" || ids[i] === undefined) return;
      const rootResult = traitResults.data?.[i * 2];
      const countResult = traitResults.data?.[i * 2 + 1];
      const trade = toTrade(ids[i], {
        ...r.result,
        requestedRoot: rootResult?.status === "success" ? rootResult.result as `0x${string}` : undefined,
        requestedCount: countResult?.status === "success" ? countResult.result as bigint : undefined,
      });
      if (trade) out.push(trade);
    });
    return out;
  }, [results.data, traitResults.data, ids, showDemoTrades]);

  return {
    trades,
    total: showDemoTrades ? BigInt(demoTrades().length) : total,
    hasMore: BigInt(trades.length) < (showDemoTrades ? BigInt(demoTrades().length) : total),
    isLoading: !showDemoTrades && (count.isLoading || (ids.length > 0 && results.isLoading)),
    error: showDemoTrades ? undefined : count.error ?? results.error,
  };
}
