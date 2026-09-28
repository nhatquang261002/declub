"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { chog } from "@/lib/contracts";
import { CHOG_SWAP_ADDRESS } from "@/lib/config";

/** Whether ChogSwap may move `owner`'s Chogs (setApprovalForAll). */
export function useChogApproval(owner: Address | undefined) {
  const result = useReadContract({
    ...chog,
    functionName: "isApprovedForAll",
    args: owner ? [owner, CHOG_SWAP_ADDRESS] : undefined,
    query: { enabled: !!owner },
  });

  return {
    isApproved: result.data ?? false,
    isLoading: result.isLoading,
    approveCall: {
      ...chog,
      functionName: "setApprovalForAll",
      args: [CHOG_SWAP_ADDRESS, true],
    } as const,
  };
}
