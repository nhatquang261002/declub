"use client";

import { useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { swapV2 } from "@/lib/contracts";
import { toProposal, type ProposalV2 } from "@/lib/proposals";

const PAGE = 20;

/**
 * The newest proposals on an open offer, newest first. `proposalCount` then one `getProposals`
 * page, like the deal list (ADR 0004): no logs, no indexer. `loadMore` widens the window.
 */
export function useProposalsV2(dealId: bigint, enabled: boolean) {
  const [limit, setLimit] = useState(PAGE);
  const active = enabled && !!swapV2;

  const count = useReadContract({
    ...swapV2!,
    functionName: "proposalCount",
    args: [dealId],
    query: { enabled: active, refetchInterval: 6_000 },
  });
  const total = count.data ?? 0n;
  const offset = total > BigInt(limit) ? total - BigInt(limit) : 0n;

  const page = useReadContract({
    ...swapV2!,
    functionName: "getProposals",
    args: [dealId, offset, BigInt(limit)],
    query: {
      enabled: active && total > 0n,
      refetchInterval: 6_000,
      placeholderData: (previous) => previous,
    },
  });

  const proposals = useMemo(() => {
    const out: ProposalV2[] = [];
    page.data?.forEach((raw, i) => {
      const proposal = toProposal(dealId, offset + BigInt(i), raw);
      if (proposal) out.push(proposal);
    });
    return out.reverse();
  }, [page.data, dealId, offset]);

  return {
    proposals,
    total,
    hasMore: offset > 0n,
    loadMore: () => setLimit((current) => current + PAGE),
    isLoading: active && (count.isLoading || (total > 0n && page.isLoading)),
    error: count.error ?? page.error,
  };
}
