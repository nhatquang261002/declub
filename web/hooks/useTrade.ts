"use client";

import { useReadContract } from "wagmi";
import { swap } from "@/lib/contracts";
import { toTrade } from "@/lib/trades";

/** One trade with live status. `trade` is null when the id doesn't exist. */
export function useTrade(id: bigint) {
  const result = useReadContract({
    ...swap,
    functionName: "getTrade",
    args: [id],
    query: { refetchInterval: 4_000 },
  });
  // The contract's view, judged against the latest block rather than the local clock.
  const expired = useReadContract({
    ...swap,
    functionName: "isExpired",
    args: [id],
    query: { refetchInterval: 4_000 },
  });

  return {
    trade: result.data ? toTrade(id, result.data) : undefined,
    isExpired: expired.data ?? false,
    isLoading: result.isLoading,
    error: result.error,
  };
}
