import type { Address } from "viem";
import { buildMerkleSet } from "./merkle";

export type TraitFilter = { traitType: string; value: string };

export const traitLabel = (filter: TraitFilter) => `${filter.traitType}: ${filter.value}`;

/**
 * Merkle root (lowercase) → the trait it commits to, for every trait/value pair in `entries`.
 * A trait request only stores the root on-chain, so this is how the UI names it. It only
 * resolves while the matching set is unchanged, the same condition the fill flow needs.
 * "None" is skipped, as in the create form.
 */
export function traitRootIndex(
  entries: readonly { id: bigint; attributes: readonly { trait_type: string; value: string }[] }[],
  collection: Address,
): Map<string, TraitFilter> {
  const sets = new Map<string, { filter: TraitFilter; ids: bigint[] }>();
  for (const { id, attributes } of entries) {
    for (const { trait_type, value } of attributes) {
      if (value === "None") continue;
      const key = `${trait_type}:${value}`;
      const set = sets.get(key) ?? { filter: { traitType: trait_type, value }, ids: [] };
      set.ids.push(id);
      sets.set(key, set);
    }
  }
  const index = new Map<string, TraitFilter>();
  for (const { filter, ids } of sets.values()) {
    index.set(buildMerkleSet(ids, collection).root.toLowerCase(), filter);
  }
  return index;
}
