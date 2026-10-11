"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { CHAIN_ID, DECLUB_ESCROW_ADDRESS } from "@/lib/config";
import { erc20Abi, erc721Abi } from "@/lib/contracts";
import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { sameAddress } from "@/lib/deals";
import type { WriteCall } from "./useTxFlow";

type ApprovalStep = {
  key: string;
  label: string;
  call: WriteCall;
};

/**
 * The approvals DeClubEscrow still needs before it can pull `assets` from `owner`, one step per
 * ERC-20 (for the exact amount, no more) and one per NFT collection (setApprovalForAll, the
 * only way to cover several ids in one transaction). `problems` reports missing assets or
 * unreadable ownership; MON needs no approval.
 *
 * Run `steps[0]` and the list shrinks by itself: useTxFlow refetches every query after a write.
 */
export function useAssetApprovals(
  owner: Address | undefined,
  assets: readonly Asset[],
  info: ReadonlyMap<string, TokenInfo>,
  nativeRequired = 0n,
) {
  const spender = DECLUB_ESCROW_ADDRESS;

  const { erc20s, collections } = useMemo(() => {
    const erc20s = assets.filter((a) => a.kind === "erc20");
    const collections = [...new Set(assets.filter((a) => a.kind === "erc721" || a.kind === "trait").map((a) => a.token))];
    return { erc20s, collections };
  }, [assets]);

  const enabled = !!owner && !!spender && (nativeRequired > 0n || erc20s.length > 0 || collections.length > 0);
  const result = useReadContracts({
    contracts: [
      ...erc20s.map(
        (a) =>
          ({
            address: a.token,
            abi: erc20Abi,
            chainId: CHAIN_ID,
            functionName: "balanceOf",
            args: [owner!],
          }) as const,
      ),
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
      ...assets
        .filter((a) => a.kind === "erc721")
        .map(
          (a) =>
            ({
              address: a.token,
              abi: erc721Abi,
              chainId: CHAIN_ID,
              functionName: "ownerOf",
              args: [a.id],
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
  const native = useBalance({ address: owner, chainId: CHAIN_ID, query: { enabled: !!owner && nativeRequired > 0n } });

  const readiness = useMemo(() => {
    if (!enabled || !spender || !result.data) return { steps: [] as ApprovalStep[], problems: [] as string[] };
    const out: ApprovalStep[] = [];
    const problems: string[] = [];
    erc20s.forEach((a, i) => {
      const balance = result.data[i];
      const allowance = result.data[erc20s.length + i];
      if (balance?.status !== "success") problems.push(`Couldn't read your ${formatAsset(a, info.get(a.token.toLowerCase()))} balance.`);
      else if ((balance.result as bigint) < a.amount) problems.push(`You don't hold enough ${formatAsset(a, info.get(a.token.toLowerCase()))}.`);
      if (allowance?.status !== "success") return;
      if ((allowance.result as bigint) < a.amount) {
        out.push({
          key: `erc20:${a.token}`,
          label: `Approve ${formatAsset(a, info.get(a.token.toLowerCase()))}`,
          call: { address: a.token, abi: erc20Abi, functionName: "approve", args: [spender, a.amount] },
        });
      }
    });
    if (nativeRequired > 0n) {
      if (native.error || (!native.isLoading && !native.data)) problems.push("Couldn't read your MON balance.");
      else if (native.data && native.data.value < nativeRequired) problems.push("You don't hold enough MON for this swap.");
    }

    const nftBase = erc20s.length * 2;
    const nfts = assets.filter((a) => a.kind === "erc721");
    nfts.forEach((a, i) => {
      const read = result.data[nftBase + i];
      if (read?.status !== "success") problems.push(`NFT #${a.id} could not be checked.`);
      else if (!sameAddress(read.result as Address, owner)) problems.push(`You don't own NFT #${a.id}.`);
    });
    const collectionBase = nftBase + nfts.length;
    collections.forEach((token, i) => {
      const read = result.data[collectionBase + i];
      if (read?.status !== "success" || read.result === true) return;
      out.push({
        key: `erc721:${token}`,
        label: `Approve NFT collection ${token.slice(0, 6)}…${token.slice(-4)}`,
        call: { address: token, abi: erc721Abi, functionName: "setApprovalForAll", args: [spender, true] },
      });
    });
    return { steps: out, problems };
  }, [enabled, spender, result.data, erc20s, assets, collections, info, nativeRequired, native.data, native.error, native.isLoading, owner]);

  return { ...readiness, isLoading: enabled && (result.isLoading || (nativeRequired > 0n && native.isLoading)) };
}
