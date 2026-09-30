"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { CHOG_ADDRESS } from "@/lib/config";
import { chog } from "@/lib/contracts";
import { traitRootIndex, type TraitFilter } from "@/lib/traitRequests";
import type { DealTraitIndex } from "@/lib/dealFilters";
import type { Deal } from "@/lib/deals";
import { traitAttributes, type OnchainTraits } from "./useChogs";

const EMPTY: DealTraitIndex = { byId: new Map(), byRoot: new Map() };

const hasTraitRequest = (t: Deal) => !!t.requestedRoot && !!t.requestedCount && t.requestedCount > 0n;

/**
 * Trait lookups for searching `deals`.
 *
 * `traitsOf` is one cheap multicall over the Chog ids in the deals. Trait requests only
 * store a Merkle root, so when any deal has one we also read the catalog's traits (ids
 * 1..totalSupply, the same set the create form commits to) and match roots against it.
 * Collections without `traitsOf` just yield empty maps, so trait search finds nothing.
 */
export function useDealTraits(deals: Deal[]): DealTraitIndex {
  const ids = useMemo(() => {
    const unique = new Set(deals.flatMap((t) => [...t.offeredIds, ...t.requestedIds]));
    return [...unique].sort((a, b) => (a < b ? -1 : 1));
  }, [deals]);
  const needsCatalog = useMemo(() => deals.some(hasTraitRequest), [deals]);

  const dealTraits = useReadContracts({
    contracts: ids.map((id) => ({ ...chog, functionName: "traitsOf", args: [id] }) as const),
    query: { enabled: ids.length > 0, staleTime: Infinity },
  });

  const supply = useReadContract({
    ...chog,
    functionName: "totalSupply",
    query: { enabled: needsCatalog, staleTime: 30_000 },
  });
  const catalogIds = useMemo(
    () => (needsCatalog ? Array.from({ length: Number(supply.data ?? 0n) }, (_, i) => BigInt(i + 1)) : []),
    [needsCatalog, supply.data],
  );
  const catalogTraits = useReadContracts({
    contracts: catalogIds.map((id) => ({ ...chog, functionName: "traitsOf", args: [id] }) as const),
    query: { enabled: catalogIds.length > 0, staleTime: 30_000 },
  });

  const byId = useMemo(() => {
    const map = new Map<bigint, TraitFilter[]>();
    dealTraits.data?.forEach((r, i) => {
      if (r.status !== "success") return;
      map.set(ids[i], toFilters(r.result as OnchainTraits));
    });
    return map;
  }, [dealTraits.data, ids]);

  const byRoot = useMemo(() => {
    const entries = (catalogTraits.data ?? []).flatMap((r, i) =>
      r.status === "success"
        ? [{ id: catalogIds[i], attributes: traitAttributes(r.result as OnchainTraits) }]
        : [],
    );
    return traitRootIndex(entries, CHOG_ADDRESS);
  }, [catalogTraits.data, catalogIds]);

  return useMemo(
    () => (byId.size === 0 && byRoot.size === 0 ? EMPTY : { byId, byRoot }),
    [byId, byRoot],
  );
}

function toFilters(traits: OnchainTraits): TraitFilter[] {
  return traitAttributes(traits)
    .filter((a) => a.value !== "None")
    .map((a) => ({ traitType: a.trait_type, value: a.value }));
}
