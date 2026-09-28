"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { chog } from "@/lib/contracts";
import { loadMetadata } from "@/lib/metadata";

/**
 * Token ids owned by `owner`, ascending. Uses ERC721Enumerable (MockChog has it).
 * The real collection may not; see docs/05-frontend.md#listing-a-wallets-chogs.
 */
export function useOwnedChogs(owner: Address | undefined) {
  const balance = useReadContract({
    ...chog,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    query: { enabled: !!owner, refetchInterval: 10_000 },
  });
  const count = Number(balance.data ?? 0n);

  const tokens = useReadContracts({
    contracts: Array.from(
      { length: count },
      (_, i) =>
        ({ ...chog, functionName: "tokenOfOwnerByIndex", args: [owner!, BigInt(i)] }) as const,
    ),
    query: { enabled: !!owner && count > 0 },
  });

  const ids = useMemo(() => {
    const out = (tokens.data ?? [])
      .filter((r) => r.status === "success")
      .map((r) => r.result as bigint);
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [tokens.data]);

  return {
    ids: count === 0 ? [] : ids,
    isLoading: balance.isLoading || (count > 0 && tokens.isLoading),
    error: balance.error ?? tokens.error,
  };
}

/** Current owner per id; null if the token doesn't exist. */
export function useChogOwners(ids: readonly bigint[]) {
  const result = useReadContracts({
    contracts: ids.map((id) => ({ ...chog, functionName: "ownerOf", args: [id] }) as const),
    query: { enabled: ids.length > 0, refetchInterval: 8_000 },
  });

  const owners = useMemo(() => {
    const map = new Map<bigint, Address | null>();
    result.data?.forEach((r, i) => {
      if (ids[i] !== undefined) map.set(ids[i], r.status === "success" ? r.result : null);
    });
    return map;
  }, [result.data, ids]);

  return { owners, isLoading: result.isLoading && ids.length > 0 };
}

/** Name, image and traits from tokenURI. Token metadata never changes, so cache forever. */
export function useChogMetadata(id: bigint) {
  const uri = useReadContract({
    ...chog,
    functionName: "tokenURI",
    args: [id],
    query: { staleTime: Infinity, retry: 1 },
  });

  const metadata = useQuery({
    queryKey: ["chogMetadata", chog.address, id.toString(), uri.data],
    queryFn: () => loadMetadata(uri.data!, id),
    enabled: !!uri.data,
    staleTime: Infinity,
  });

  return { metadata: metadata.data, isLoading: uri.isLoading || metadata.isLoading };
}
