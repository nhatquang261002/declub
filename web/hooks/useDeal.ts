"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { swapEscrow } from "@/lib/contracts";
import { toDeal } from "@/lib/deals";
import { parseSpec } from "@/lib/traitSpec";

/**
 * One DeClubEscrow deal by id, with the maker's note if it is an open offer (empty otherwise) and the
 * trait-request description if it has trait assets.
 * `deal` is null for an id that doesn't exist.
 */
export function useDeal(id: bigint) {
  const result = useReadContracts({
    contracts: [
      { ...swapEscrow!, functionName: "getTrade", args: [id] },
      { ...swapEscrow!, functionName: "offerNote", args: [id] },
      { ...swapEscrow!, functionName: "traitSpec", args: [id] },
    ],
    query: { enabled: !!swapEscrow, refetchInterval: 6_000 },
  });
  const [dealRead, noteRead, specRead] = result.data ?? [];
  const deal = useMemo(() => (dealRead?.status === "success" ? toDeal(id, dealRead.result) : null), [dealRead, id]);
  const note = noteRead?.status === "success" ? noteRead.result : "";
  // What the maker published about the deal's trait requests, one entry per trait asset in order.
  // null when there is none, or it isn't something this app wrote (the deal then can't be filled here).
  const specText = specRead?.status === "success" ? specRead.result : "";
  const traitClauses = useMemo(() => (specText ? parseSpec(specText) : null), [specText]);
  return {
    deal,
    note,
    traitClauses,
    isLoading: !!swapEscrow && result.isLoading,
    error: dealRead?.status === "failure" ? dealRead.error : result.error,
  };
}
