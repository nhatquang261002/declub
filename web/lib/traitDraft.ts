import { isAddress } from "viem";
import type { CatalogStatus } from "@/hooks/useCollectionTraits";
import { resolveClause, type ResolvedClause, type TraitClause, type TraitMode, type TraitPick } from "./traitSpec";

/** One trait request on the create form, as chosen. */
export type TraitDraft = {
  key: string;
  collection: string;
  picks: TraitPick[];
  mode: TraitMode;
  amount: number;
};

let counter = 0;
export const newTraitDraft = (collection = ""): TraitDraft => ({
  key: `trait-${++counter}`,
  collection,
  picks: [],
  mode: "any",
  amount: 1,
});

/** A draft's clause, once its collection has been scanned and it has a valid address. */
export function draftClause(draft: TraitDraft): TraitClause | null {
  const token = draft.collection.trim();
  return isAddress(token) ? { token, mode: draft.mode, picks: draft.picks, amount: draft.amount } : null;
}

/**
 * Each draft's set, or null while its collection isn't ready. Everything the contract call
 * needs (root, ids, proofs) is derived from this, never typed.
 */
export function resolveDrafts(drafts: readonly TraitDraft[], status: (collection: string) => CatalogStatus): (ResolvedClause | null)[] {
  return drafts.map((draft) => {
    const clause = draftClause(draft);
    const s = status(draft.collection);
    return clause && s.state === "ready" ? resolveClause(s.catalog, clause) : null;
  });
}
