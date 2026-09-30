"use client";

import { useMemo } from "react";
import { isAddress, type Address } from "viem";
import { useQueries } from "@tanstack/react-query";
import type { WireCatalog } from "@/lib/server/collectionScan";
import { traitKey, type TraitCatalog } from "@/lib/traitSpec";

/** Where one collection's trait scan stands. `idle` = no valid address yet. */
export type CatalogStatus =
  | { state: "idle" }
  | { state: "scanning"; done: number; total: number }
  | { state: "ready"; catalog: TraitCatalog; failed: number }
  | { state: "unsupported"; reason: string }
  | { state: "busy" };

type Reply =
  | { state: "scanning"; done: number; total: number }
  | { state: "ready"; catalog: WireCatalog }
  | { state: "unsupported"; reason: string }
  | { state: "busy" };

const IDLE: CatalogStatus = { state: "idle" };

function expand(wire: WireCatalog): TraitCatalog {
  const keys = wire.values.map(([traitType, value]) => traitKey({ traitType, value }));
  return {
    enumerable: wire.enumerable,
    tokens: wire.tokens.map(([id, indexes]) => ({ id: BigInt(id), keys: indexes.map((i) => keys[i]) })),
  };
}

async function load(address: Address): Promise<Reply> {
  const res = await fetch(`/api/collection-traits?address=${address}`);
  const body = (await res.json()) as Reply;
  if (!body || typeof body !== "object" || !("state" in body)) throw new Error("Unexpected reply.");
  return body;
}

/**
 * The traits of each collection in `addresses`, keyed by lowercase address. The server scans a
 * collection once and caches it, so this just polls until the scan is `ready` or `unsupported`.
 * `preview` swaps in a fixed catalog so the create screens can be shown without a server scan.
 */
export function useCollectionCatalogs(
  addresses: readonly string[],
  preview?: TraitCatalog,
): ReadonlyMap<string, CatalogStatus> {
  const valid = useMemo(() => [...new Set(addresses.map((a) => a.trim()).filter((a) => isAddress(a)).map((a) => a.toLowerCase() as Address))], [addresses]);
  const queries = useQueries({
    queries: valid.map((address) => ({
      queryKey: ["collectionTraits", address],
      queryFn: () => load(address),
      enabled: !preview,
      staleTime: 60_000,
      retry: 1,
      refetchInterval: (query: { state: { data?: Reply } }) => {
        const state = query.state.data?.state;
        return state === "scanning" || state === "busy" ? 1_500 : false;
      },
    })),
  });

  // `queries` is a new array every render; its results only change with these stamps.
  const stamp = queries.map((q) => `${q.dataUpdatedAt}:${q.isError}`).join("|");
  return useMemo(() => {
    const out = new Map<string, CatalogStatus>();
    valid.forEach((address, i) => {
      if (preview) return out.set(address, { state: "ready", catalog: preview, failed: 0 });
      const q = queries[i];
      const data = q.data;
      if (!data) {
        return out.set(address, q.isError ? { state: "unsupported", reason: "Couldn't reach the trait scanner. Try again." } : { state: "scanning", done: 0, total: 0 });
      }
      out.set(address, data.state === "ready" ? { state: "ready", catalog: expand(data.catalog), failed: data.catalog.failed } : data);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, preview, stamp]);
}

export const statusOf = (statuses: ReadonlyMap<string, CatalogStatus>, address: string): CatalogStatus =>
  statuses.get(address.trim().toLowerCase()) ?? IDLE;
