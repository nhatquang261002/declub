"use client";

import { useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { swapEscrow } from "@/lib/contracts";
import { toProposal, type Proposal } from "@/lib/proposals";

const PAGE = 20;

/**
 * The newest proposals on an open offer, newest first. `proposalCount` then one `getProposals`
 * page, like the deal list (ADR 0004): no logs, no indexer. `loadMore` widens the window.
 */
export function useProposals(dealId: bigint, enabled: boolean) {
  const [limit, setLimit] = useState(PAGE);
  const active = enabled && !!swapEscrow;

  const count = useReadContract({
    ...swapEscrow!,
    functionName: "proposalCount",
    args: [dealId],
    query: { enabled: active, refetchInterval: 6_000 },
  });
  const total = count.data ?? 0n;
  const offset = total > BigInt(limit) ? total - BigInt(limit) : 0n;

  const page = useReadContract({
    ...swapEscrow!,
    functionName: "getProposals",
    args: [dealId, offset, BigInt(limit)],
    query: {
      enabled: active && total > 0n,
      refetchInterval: 6_000,
      placeholderData: (previous) => previous,
    },
  });

  const proposals = useMemo(() => {
    const out: Proposal[] = [];
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
