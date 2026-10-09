"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { useQueries } from "@tanstack/react-query";
import { CHAIN_ID } from "@/lib/config";
import { ENUMERABLE_INTERFACE, ERC721_INTERFACE, nftReadAbi, safeImage, type CollectionInfo } from "@/lib/collections";
import { loadMetadata } from "@/lib/metadata";

const OWNED_CAP = 100;

const read = (address: Address) => ({ address, abi: nftReadAbi, chainId: CHAIN_ID }) as const;

/**
 * What each collection says about itself: name, symbol, whether it is an ERC-721 and whether it can
 * list tokens. Every call may fail on a real contract, so a missing answer is just `null`/`false`.
 */
export function useCollectionInfos(addresses: readonly Address[]) {
  const result = useReadContracts({
    contracts: addresses.flatMap(
      (a) =>
        [
          { ...read(a), functionName: "name" },
          { ...read(a), functionName: "symbol" },
          { ...read(a), functionName: "supportsInterface", args: [ERC721_INTERFACE] },
          { ...read(a), functionName: "supportsInterface", args: [ENUMERABLE_INTERFACE] },
          { ...read(a), functionName: "totalSupply" },
        ] as const,
    ),
    query: { enabled: addresses.length > 0, staleTime: 60_000 },
  });

  const infos = useMemo(() => {
    const out = new Map<string, CollectionInfo>();
    addresses.forEach((address, i) => {
      const [name, symbol, is721, isEnum, supply] = [0, 1, 2, 3, 4].map((k) => result.data?.[i * 5 + k]);
      if (!result.data) return;
      out.set(address.toLowerCase(), {
        address,
        name: name?.status === "success" ? String(name.result).slice(0, 48) : null,
        symbol: symbol?.status === "success" ? String(symbol.result).slice(0, 16) : null,
        isErc721: is721?.status === "success" && is721.result === true,
        enumerable: isEnum?.status === "success" && isEnum.result === true,
        totalSupply: supply?.status === "success" ? (supply.result as bigint) : null,
      });
    });
    return out;
  }, [addresses, result.data]);

  return { infos, isLoading: result.isLoading };
}

export function useCollectionInfo(address: Address | undefined) {
  const list = useMemo(() => (address ? [address] : []), [address]);
  const { infos, isLoading } = useCollectionInfos(list);
  return { info: address ? infos.get(address.toLowerCase()) : undefined, isLoading: !!address && isLoading };
}

/** The ids `owner` holds in an enumerable collection, ascending. `total` can exceed what is listed. */
export function useOwnedTokenIds(collection: Address | undefined, owner: Address | undefined, enumerable: boolean) {
  const on = !!collection && !!owner && enumerable;
  const balance = useReadContract({
    ...read(collection!),
    functionName: "balanceOf",
    args: [owner!],
    query: { enabled: on },
  });
  const total = Number(balance.data ?? 0n);
  const count = Math.min(total, OWNED_CAP);
  const listed = useReadContracts({
    contracts: Array.from(
      { length: on ? count : 0 },
      (_, i) => ({ ...read(collection!), functionName: "tokenOfOwnerByIndex", args: [owner!, BigInt(i)] }) as const,
    ),
    query: { enabled: on && count > 0 },
  });
  const ids = useMemo(
    () => (listed.data ?? []).flatMap((r) => (r.status === "success" ? [r.result as bigint] : [])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [listed.data],
  );
  return { ids: count === 0 ? [] : ids, total, isLoading: on && (balance.isLoading || (count > 0 && listed.isLoading)) };
}

/** One page of an enumerable collection, by `tokenByIndex`. */
export function useBrowseTokenIds(collection: Address | undefined, enumerable: boolean, supply: bigint | null, page: number, pageSize: number) {
  const first = page * pageSize;
  const count = supply === null ? 0 : Math.max(0, Math.min(pageSize, Number(supply) - first));
  const on = !!collection && enumerable && count > 0;
  const listed = useReadContracts({
    contracts: Array.from({ length: on ? count : 0 }, (_, i) => ({ ...read(collection!), functionName: "tokenByIndex", args: [BigInt(first + i)] }) as const),
    query: { enabled: on, staleTime: 30_000 },
  });
  const ids = useMemo(() => (listed.data ?? []).flatMap((r) => (r.status === "success" ? [r.result as bigint] : [])), [listed.data]);
  return { ids: on ? ids : [], isLoading: on && listed.isLoading };
}

type TokenView = { name: string | null; image: string | null };

/** Name and art for each token, from its `tokenURI`, plus who owns it when `withOwners` is set. */
export function useTokenViews(collection: Address | undefined, ids: readonly bigint[], withOwners = false) {
  const on = !!collection && ids.length > 0;
  const uris = useReadContracts({
    contracts: ids.map((id) => ({ ...read(collection!), functionName: "tokenURI", args: [id] }) as const),
    query: { enabled: on, staleTime: Infinity },
  });
  const owners = useReadContracts({
    contracts: ids.map((id) => ({ ...read(collection!), functionName: "ownerOf", args: [id] }) as const),
    query: { enabled: on && withOwners, staleTime: 30_000 },
  });
  const metadata = useQueries({
    queries: ids.map((id, i) => {
      const uri = uris.data?.[i];
      return {
        queryKey: ["nftMetadata", collection?.toLowerCase(), id.toString(), uri?.status === "success" ? uri.result : null],
        queryFn: () => loadMetadata(uri!.result as string, id),
        enabled: uri?.status === "success",
        staleTime: Infinity,
        retry: 1,
      };
    }),
  });

  // Cheap to rebuild, and `metadata` is a fresh array each render, so there is nothing to memoize on.
  const views = new Map<string, TokenView & { owner: Address | null }>();
  ids.forEach((id, i) => {
    const m = metadata[i]?.data;
    const o = owners.data?.[i];
    views.set(id.toString(), {
      name: m?.name ?? null,
      image: safeImage(m?.image),
      owner: o?.status === "success" ? (o.result as Address) : null,
    });
  });

  return views;
}

/** Who owns one token, for a typed id. `exists` is false when `ownerOf` reverts. */
export function useTokenOwner(collection: Address | undefined, id: bigint | null) {
  const result = useReadContract({
    ...read(collection!),
    functionName: "ownerOf",
    args: [id ?? 0n],
    query: { enabled: !!collection && id !== null, retry: false },
  });
  return {
    owner: (result.data as Address | undefined) ?? null,
    exists: result.isSuccess,
    isLoading: id !== null && result.isLoading,
  };
}
