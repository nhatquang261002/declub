"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { chog } from "@/lib/contracts";
import { ON_DEAL_ADDRESS } from "@/lib/config";

/** Whether OnDeal may move `owner`'s Chogs (setApprovalForAll). */
export function useChogApproval(owner: Address | undefined) {
  const result = useReadContract({
    ...chog,
    functionName: "isApprovedForAll",
    args: owner ? [owner, ON_DEAL_ADDRESS] : undefined,
    query: { enabled: !!owner },
  });

  return {
    isApproved: result.data ?? false,
    isLoading: result.isLoading,
    approveCall: {
      ...chog,
      functionName: "setApprovalForAll",
      args: [ON_DEAL_ADDRESS, true],
    } as const,
  };
}
