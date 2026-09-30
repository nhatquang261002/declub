"use client";

import { useMemo } from "react";
import { parseAbi, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { CHAIN_ID } from "@/lib/config";

const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address, uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
]);

const MAX_ENUMERATED = 500n;
const MAX_CHECKED = 3_000;

/**
 * Which of `ids` (the set a trait request matches) `owner` holds. Uses the wallet's own token
 * list when the collection is enumerable, and otherwise checks `ownerOf` for each id in the set.
 * `tooLarge` means the set is too big to check that way.
 */
export function useOwnedInSet(
  collection: Address,
  owner: Address | undefined,
  ids: readonly bigint[],
  enumerable: boolean,
) {
  const on = !!owner && ids.length > 0;
  const balance = useReadContract({
    address: collection,
    abi,
    chainId: CHAIN_ID,
    functionName: "balanceOf",
    args: [owner!],
    query: { enabled: on },
  });
  const held = balance.data ?? 0n;
  const enumerate = enumerable && held <= MAX_ENUMERATED;
  const tooLarge = on && !enumerate && ids.length > MAX_CHECKED;

  const listed = useReadContracts({
    contracts: Array.from({ length: enumerate ? Number(held) : 0 }, (_, i) => ({
      address: collection,
      abi,
      chainId: CHAIN_ID,
      functionName: "tokenOfOwnerByIndex",
      args: [owner!, BigInt(i)],
    }) as const),
    query: { enabled: on && enumerate && held > 0n },
  });
  const checked = useReadContracts({
    contracts: (on && !enumerate && !tooLarge && held > 0n ? ids : []).map(
      (id) => ({ address: collection, abi, chainId: CHAIN_ID, functionName: "ownerOf", args: [id] }) as const,
    ),
    query: { enabled: on && !enumerate && !tooLarge && held > 0n },
  });

  const owned = useMemo(() => {
    const inSet = new Set(ids.map(String));
    if (enumerate) {
      return (listed.data ?? []).flatMap((r) => (r.status === "success" && inSet.has(String(r.result)) ? [r.result as bigint] : []));
    }
    return ids.filter((_, i) => {
      const r = checked.data?.[i];
      return r?.status === "success" && String(r.result).toLowerCase() === owner?.toLowerCase();
    });
  }, [ids, enumerate, listed.data, checked.data, owner]);

  return {
    owned,
    tooLarge,
    isLoading: on && (balance.isLoading || listed.isLoading || checked.isLoading),
  };
}
