"use client";

import { useMemo, useState } from "react";
import type { Hex } from "viem";
import { useCollectionCatalogs, statusOf, type CatalogStatus } from "@/hooks/useCollectionTraits";
import { traitRoot, type Asset } from "@/lib/assets";
import { resolveClause, rootMatches, type ResolvedClause, type TraitClause } from "@/lib/traitSpec";
import type { ClauseCheck } from "@/components/TraitClause";

export type TraitSlot = {
  asset: Asset;
  /** The maker's description, with the amount taken from the deal itself. */
  clause: TraitClause;
  status: CatalogStatus;
  check: ClauseCheck;
  /** The rebuilt set, only when it matches the deal's root. */
  resolved: ResolvedClause | null;
  chosen: bigint[];
};

/**
 * A taker's side of a trade with trait requests. Each trait asset in `requested` pairs, in order,
 * with one clause of the maker's published spec. The set is rebuilt from the collection's traits
 * and used only if its root equals the deal's, so a wrong or stale description just disables the
 * fill instead of producing a bad one.
 */
export function useTraitFill(requested: readonly Asset[], clauses: readonly TraitClause[] | null) {
  const traitAssets = useMemo(() => requested.filter((a) => a.kind === "trait"), [requested]);
  const [picked, setPicked] = useState<Record<number, bigint[]>>({});

  // The spec has to line up with the deal: one clause per trait asset, same collection.
  const aligned = !!clauses && clauses.length === traitAssets.length && clauses.every((c, i) => c.token.toLowerCase() === traitAssets[i].token.toLowerCase());

  const statuses = useCollectionCatalogs(aligned ? traitAssets.map((a) => a.token) : []);

  const slots = useMemo<TraitSlot[]>(() => {
    if (!aligned || !clauses) return [];
    return traitAssets.map((asset, i) => {
      const clause = { ...clauses[i], amount: Number(asset.amount) };
      const status = statusOf(statuses, asset.token);
      let check: ClauseCheck = "checking";
      let resolved: ResolvedClause | null = null;
      if (status.state === "unsupported") check = "unavailable";
      else if (status.state === "ready") {
        const matches = rootMatches(status.catalog, clause, traitRoot(asset));
        check = matches ? "matches" : "differs";
        if (matches) resolved = resolveClause(status.catalog, clause);
      }
      return { asset, clause, status, check, resolved, chosen: picked[i] ?? [] };
    });
  }, [aligned, clauses, traitAssets, statuses, picked]);

  const toggle = (slot: number, id: bigint) =>
    setPicked((current) => {
      const now = current[slot] ?? [];
      const max = Number(traitAssets[slot].amount);
      const next = now.includes(id) ? now.filter((x) => x !== id) : now.length < max ? [...now, id] : now;
      return { ...current, [slot]: next };
    });

  const complete = slots.length === traitAssets.length && slots.every((s) => s.check === "matches" && s.chosen.length === Number(s.asset.amount));
  /** What `fillTraitTrade` takes, once every slot is complete. */
  const fills = complete
    ? slots.map((s) => ({
        tokenIds: s.chosen,
        proofs: s.chosen.map((id) => s.resolved!.set.proofs.get(id)! as Hex[]),
      }))
    : null;

  return { hasTraits: traitAssets.length > 0, aligned, slots, toggle, complete, fills };
}
