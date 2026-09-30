import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export type MerkleSet = {
  root: Hex;
  proofs: Map<bigint, Hex[]>;
  count: number;
};

function pair(a: Hex, b: Hex): Hex {
  const [left, right] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(`0x${left.slice(2)}${right.slice(2)}` as Hex);
}

export function tokenLeaf(collection: Address, tokenId: bigint): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [collection, tokenId],
  ));
}

export function buildMerkleSet(ids: readonly bigint[], collection: Address): MerkleSet {
  const unique = [...new Set(ids.map(String))].map(BigInt).sort((a, b) => (a < b ? -1 : 1));
  const proofs = new Map(unique.map((id) => [id, [] as Hex[]]));
  if (unique.length === 0) return { root: "0x" as Hex, proofs, count: 0 };

  // Every id under a node needs that node's sibling in its proof, not just the leftmost one.
  let level = unique.map((id) => tokenLeaf(collection, id));
  let members = unique.map((id) => [id]);
  while (level.length > 1) {
    const next: Hex[] = [];
    const nextMembers: bigint[][] = [];
    for (let i = 0; i < level.length; i += 2) {
      const sibling = level[i + 1];
      if (sibling) {
        for (const id of members[i]) proofs.get(id)!.push(sibling);
        for (const id of members[i + 1]) proofs.get(id)!.push(level[i]);
      }
      next.push(sibling ? pair(level[i], sibling) : level[i]);
      nextMembers.push(sibling ? [...members[i], ...members[i + 1]] : members[i]);
    }
    level = next;
    members = nextMembers;
  }
  return { root: level[0], proofs, count: unique.length };
}
