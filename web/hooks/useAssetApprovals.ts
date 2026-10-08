"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { CHAIN_ID, DECLUB_ESCROW_ADDRESS } from "@/lib/config";
import { erc20Abi, erc721Abi } from "@/lib/contracts";
import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import type { WriteCall } from "./useTxFlow";

type ApprovalStep = {
  key: string;
  label: string;
  call: WriteCall;
};

/**
 * The approvals DeClubEscrow still needs before it can pull `assets` from `owner`, one step per
 * ERC-20 (for the exact amount, no more) and one per NFT collection (setApprovalForAll, the
 * only way to cover several ids in one transaction). Empty means ready. MON needs none.
 *
 * Run `steps[0]` and the list shrinks by itself: useTxFlow refetches every query after a write.
 */
export function useAssetApprovals(owner: Address | undefined, assets: readonly Asset[], info: ReadonlyMap<string, TokenInfo>) {
  const spender = DECLUB_ESCROW_ADDRESS;

  const { erc20s, collections } = useMemo(() => {
    const erc20s = assets.filter((a) => a.kind === "erc20");
    const collections = [...new Set(assets.filter((a) => a.kind === "erc721" || a.kind === "trait").map((a) => a.token))];
    return { erc20s, collections };
  }, [assets]);

  const enabled = !!owner && !!spender && (erc20s.length > 0 || collections.length > 0);
  const result = useReadContracts({
    contracts: [
      ...erc20s.map(
        (a) =>
          ({
            address: a.token,
            abi: erc20Abi,
            chainId: CHAIN_ID,
            functionName: "allowance",
            args: [owner!, spender!],
          }) as const,
      ),
      ...collections.map(
        (token) =>
          ({
            address: token,
            abi: erc721Abi,
            chainId: CHAIN_ID,
            functionName: "isApprovedForAll",
            args: [owner!, spender!],
          }) as const,
      ),
    ],
    query: { enabled },
  });

  const steps = useMemo<ApprovalStep[]>(() => {
    if (!enabled || !spender || !result.data) return [];
    const out: ApprovalStep[] = [];
    erc20s.forEach((a, i) => {
      const read = result.data[i];
      if (read?.status !== "success" || (read.result as bigint) >= a.amount) return;
      out.push({
        key: `erc20:${a.token}`,
        label: `Approve ${formatAsset(a, info.get(a.token.toLowerCase()))}`,
        call: { address: a.token, abi: erc20Abi, functionName: "approve", args: [spender, a.amount] },
      });
    });
    collections.forEach((token, i) => {
      const read = result.data[erc20s.length + i];
      if (read?.status !== "success" || read.result === true) return;
      out.push({
        key: `erc721:${token}`,
        label: `Approve NFT collection ${token.slice(0, 6)}…${token.slice(-4)}`,
        call: { address: token, abi: erc721Abi, functionName: "setApprovalForAll", args: [spender, true] },
      });
    });
    return out;
  }, [enabled, spender, result.data, erc20s, collections, info]);

  return { steps, isLoading: enabled && result.isLoading };
}
