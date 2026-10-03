"use client";

import { useMemo } from "react";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import { swap } from "@/lib/contracts";
import { demoDeals, isDemoDealId } from "@/lib/demoDeals";
import { toDeal } from "@/lib/deals";

/** One deal with live status. `deal` is null when the id doesn't exist. */
export function useDeal(id: bigint) {
  // A mock deal (lib/demoDeals.ts) is never read from the chain.
  const demo = isDemoDealId(id);
  const { address } = useConnection();
  const demoDeal = useMemo(() => (demo ? demoDeals(address).find((d) => d.id === id) : undefined), [demo, address, id]);
  const result = useReadContract({
    ...swap,
    functionName: "getTrade",
    args: [id],
    query: { enabled: !demo, refetchInterval: 4_000 },
  });
  // The contract's view, judged against the latest block rather than the local clock.
  const expired = useReadContract({
    ...swap,
    functionName: "isExpired",
    args: [id],
    query: { enabled: !demo, refetchInterval: 4_000 },
  });
  const trait = useReadContracts({
    contracts: [
      { ...swap, functionName: "requestedRoot", args: [id] },
      { ...swap, functionName: "requestedCount", args: [id] },
    ] as const,
    query: { enabled: !demo, refetchInterval: 8_000 },
  });
  if (demoDeal) return { deal: demoDeal, isExpired: false, isLoading: false, error: null };
  const raw = result.data;
  const requestedRoot = trait.data?.[0]?.status === "success" ? trait.data[0].result : undefined;
  const requestedCount = trait.data?.[1]?.status === "success" ? trait.data[1].result : undefined;

  return {
    deal: raw ? toDeal(id, { ...raw, requestedRoot, requestedCount }) : undefined,
    isExpired: expired.data ?? false,
    isLoading: result.isLoading,
    error: result.error,
  };
}
