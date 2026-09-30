"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { swapV2 } from "@/lib/contracts";
import { toDealV2 } from "@/lib/dealsV2";

/**
 * One ChogSwapV2 deal by id, with the maker's note if it is an open offer (empty otherwise).
 * `deal` is null for an id that doesn't exist.
 */
export function useDealV2(id: bigint) {
  const result = useReadContracts({
    contracts: [
      { ...swapV2!, functionName: "getTrade", args: [id] },
      { ...swapV2!, functionName: "offerNote", args: [id] },
    ],
    query: { enabled: !!swapV2, refetchInterval: 6_000 },
  });
  const [dealRead, noteRead] = result.data ?? [];
  const deal = useMemo(
    () => (dealRead?.status === "success" ? toDealV2(id, dealRead.result) : null),
    [dealRead, id],
  );
  const note = noteRead?.status === "success" ? noteRead.result : "";
  return {
    deal,
    note,
    isLoading: !!swapV2 && result.isLoading,
    error: dealRead?.status === "failure" ? dealRead.error : result.error,
  };
}
