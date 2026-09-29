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

  let level = unique.map((id) => tokenLeaf(collection, id));
  let levelIds = unique;
  while (level.length > 1) {
    const next: Hex[] = [];
    const nextIds: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const sibling = level[i + 1];
      if (sibling) {
        proofs.get(levelIds[i])!.push(sibling);
        proofs.get(levelIds[i + 1])!.push(level[i]);
      }
      next.push(sibling ? pair(level[i], sibling) : level[i]);
      nextIds.push(levelIds[i]);
    }
    level = next;
    levelIds = nextIds;
  }
  return { root: level[0], proofs, count: unique.length };
}
