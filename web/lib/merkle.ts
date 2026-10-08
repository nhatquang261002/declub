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

function tokenLeaf(collection: Address, tokenId: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [collection, tokenId]));
}

type MerkleTree = {
  root: Hex;
  /** One proof per leaf, in the order given. */
  proofs: Hex[][];
};

/**
 * A sorted-pair tree over `leaves` as given (OpenZeppelin `MerkleProof`; an odd last node is
 * carried up as is). Every leaf under a node needs that node's sibling in its proof, not just the
 * leftmost one. No leaves gives the root "0x".
 */
export function buildMerkleTree(leaves: readonly Hex[]): MerkleTree {
  const proofs = leaves.map(() => [] as Hex[]);
  if (leaves.length === 0) return { root: "0x" as Hex, proofs };
  let level = [...leaves];
  let members = leaves.map((_, i) => [i]);
  while (level.length > 1) {
    const next: Hex[] = [];
    const nextMembers: number[][] = [];
    for (let i = 0; i < level.length; i += 2) {
      const sibling = level[i + 1];
      if (sibling) {
        for (const k of members[i]) proofs[k].push(sibling);
        for (const k of members[i + 1]) proofs[k].push(level[i]);
      }
      next.push(sibling ? pair(level[i], sibling) : level[i]);
      nextMembers.push(sibling ? [...members[i], ...members[i + 1]] : members[i]);
    }
    level = next;
    members = nextMembers;
  }
  return { root: level[0], proofs };
}

export function buildMerkleSet(ids: readonly bigint[], collection: Address): MerkleSet {
  const unique = [...new Set(ids.map(String))].map(BigInt).sort((a, b) => (a < b ? -1 : 1));
  const tree = buildMerkleTree(unique.map((id) => tokenLeaf(collection, id)));
  return { root: tree.root, proofs: new Map(unique.map((id, i) => [id, tree.proofs[i]])), count: unique.length };
}
