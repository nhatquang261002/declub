"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { chog } from "@/lib/contracts";
import { loadMetadata } from "@/lib/metadata";

export type OnchainTraits = readonly [string, string, string];

export function traitAttributes(traits: OnchainTraits | undefined) {
  if (!traits) return [];
  return [
    { trait_type: "Hat", value: traits[0] },
    { trait_type: "Eyes", value: traits[1] },
    { trait_type: "Background", value: traits[2] },
  ];
}

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

/** Metadata for every Chog currently owned by `owner`. */
export function useOwnedChogMetadata(owner: Address | undefined) {
  const { ids, isLoading: idsLoading, error: idsError } = useOwnedChogs(owner);
  const tokenUris = useReadContracts({
    contracts: ids.map((id) => ({ ...chog, functionName: "tokenURI", args: [id] }) as const),
    query: { enabled: ids.length > 0, staleTime: Infinity },
  });
  const traits = useReadContracts({
    contracts: ids.map((id) => ({ ...chog, functionName: "traitsOf", args: [id] }) as const),
    query: { enabled: ids.length > 0, staleTime: Infinity },
  });
  const queries = useQueries({
    queries: ids.map((id, index) => ({
      queryKey: ["ownedChogMetadata", chog.address, id.toString(), tokenUris.data?.[index]?.result],
      queryFn: () => loadMetadata(tokenUris.data![index].result as string, id),
      enabled: tokenUris.data?.[index]?.status === "success",
      staleTime: Infinity,
    })),
  });
  return {
    entries: ids.flatMap((id, index) => {
      const metadata = queries[index]?.data;
      const result = traits.data?.[index];
      const onchainAttributes = result?.status === "success"
        ? traitAttributes(result.result as OnchainTraits)
        : [];
      if (metadata) {
        return [{
          id,
          metadata: {
            ...metadata,
            attributes: onchainAttributes.length > 0 ? onchainAttributes : metadata.attributes,
          },
        }];
      }
      return onchainAttributes.length > 0
        ? [{ id, metadata: { name: `Chog #${id}`, image: null, attributes: onchainAttributes } }]
        : [];
    }),
    isLoading: idsLoading
      || tokenUris.isLoading
      || traits.isLoading
      || queries.some((query: UseQueryResult) => query.isLoading),
    error: idsError
      ?? tokenUris.error
      ?? traits.error
      ?? queries.find((query: UseQueryResult) => query.error)?.error,
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
  const traits = useReadContract({
    ...chog,
    functionName: "traitsOf",
    args: [id],
    query: { staleTime: Infinity, retry: 1 },
  });
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

  const onchainAttributes = traitAttributes(traits.data as OnchainTraits | undefined);
  return {
    metadata: metadata.data
      ? { ...metadata.data, attributes: onchainAttributes.length > 0 ? onchainAttributes : metadata.data.attributes }
      : traits.data
        ? { name: `Chog #${id}`, image: null, attributes: onchainAttributes }
        : undefined,
    isLoading: traits.isLoading || uri.isLoading || metadata.isLoading,
  };
}

/**
 * Loads the complete enumerable MockChog catalog for trait-request creation.
 * Pass `enabled: false` to skip the reads until a screen actually needs the catalog.
 */
export function useChogCatalog({ enabled = true }: { enabled?: boolean } = {}) {
  const supply = useReadContract({
    ...chog,
    functionName: "totalSupply",
    query: { enabled, staleTime: 30_000 },
  });
  const count = Number(supply.data ?? 0n);
  const ids = Array.from({ length: count }, (_, index) => BigInt(index + 1));
  const tokenUris = useReadContracts({
    contracts: ids.map((id) => ({ ...chog, functionName: "tokenURI", args: [id] }) as const),
    query: { enabled: count > 0, staleTime: 30_000 },
  });
  const traits = useReadContracts({
    contracts: ids.map((id) => ({ ...chog, functionName: "traitsOf", args: [id] }) as const),
    query: { enabled: count > 0, staleTime: Infinity },
  });
  const metadata = useQueries({
    queries: ids.map((id, index) => ({
      queryKey: ["chogCatalogMetadata", chog.address, id.toString(), tokenUris.data?.[index]?.result],
      queryFn: () => loadMetadata(tokenUris.data![index].result as string, id),
      enabled: tokenUris.data?.[index]?.status === "success",
      staleTime: Infinity,
    })),
  });
  return {
    ids,
    entries: ids.flatMap((id, index) => {
      const data = metadata[index]?.data;
      const result = traits.data?.[index];
      const onchainAttributes = result?.status === "success"
        ? traitAttributes(result.result as OnchainTraits)
        : [];
      if (data) {
        return [{
          id,
          metadata: {
            ...data,
            attributes: onchainAttributes.length > 0 ? onchainAttributes : data.attributes,
          },
        }];
      }
      return onchainAttributes.length > 0
        ? [{ id, metadata: { name: `Chog #${id}`, image: null, attributes: onchainAttributes } }]
        : [];
    }),
    isLoading: supply.isLoading
      || tokenUris.isLoading
      || traits.isLoading
      || metadata.some((query: UseQueryResult) => query.isLoading),
    isEnumerable: true,
  };
}
