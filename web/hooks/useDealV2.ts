"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { swapV2 } from "@/lib/contracts";
import { toDealV2 } from "@/lib/dealsV2";
import { parseSpec } from "@/lib/traitSpec";

/**
 * One DeClubEscrow deal by id, with the maker's note if it is an open offer (empty otherwise) and the
 * trait-request description if it has trait assets.
 * `deal` is null for an id that doesn't exist.
 */
export function useDealV2(id: bigint) {
  const result = useReadContracts({
    contracts: [
      { ...swapV2!, functionName: "getTrade", args: [id] },
      { ...swapV2!, functionName: "offerNote", args: [id] },
      { ...swapV2!, functionName: "traitSpec", args: [id] },
    ],
    query: { enabled: !!swapV2, refetchInterval: 6_000 },
  });
  const [dealRead, noteRead, specRead] = result.data ?? [];
  const deal = useMemo(() => (dealRead?.status === "success" ? toDealV2(id, dealRead.result) : null), [dealRead, id]);
  const note = noteRead?.status === "success" ? noteRead.result : "";
  // What the maker published about the deal's trait requests, one entry per trait asset in order.
  // null when there is none, or it isn't something this app wrote (the deal then can't be filled here).
  const specText = specRead?.status === "success" ? specRead.result : "";
  const traitClauses = useMemo(() => (specText ? parseSpec(specText) : null), [specText]);
  return {
    deal,
    note,
    traitClauses,
    isLoading: !!swapV2 && result.isLoading,
    error: dealRead?.status === "failure" ? dealRead.error : result.error,
  };
}
