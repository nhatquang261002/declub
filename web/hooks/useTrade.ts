"use client";

import { useReadContract, useReadContracts } from "wagmi";
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
  const trait = useReadContracts({
    contracts: [
      { ...swap, functionName: "requestedRoot", args: [id] },
      { ...swap, functionName: "requestedCount", args: [id] },
    ] as const,
    query: { refetchInterval: 8_000 },
  });
  const raw = result.data;
  const requestedRoot = trait.data?.[0]?.status === "success" ? trait.data[0].result : undefined;
  const requestedCount = trait.data?.[1]?.status === "success" ? trait.data[1].result : undefined;

  return {
    trade: raw ? toTrade(id, { ...raw, requestedRoot, requestedCount }) : undefined,
    isExpired: expired.data ?? false,
    isLoading: result.isLoading,
    error: result.error,
  };
}
