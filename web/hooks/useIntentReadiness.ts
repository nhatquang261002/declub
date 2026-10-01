"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { CHAIN_ID, CHOG_SWAP_INTENTS_ADDRESS } from "@/lib/config";
import { erc20Abi, erc721Abi } from "@/lib/contracts";
import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { sameAddress } from "@/lib/deals";
import type { WriteCall } from "./useTxFlow";

export type ApprovalStep = { key: string; label: string; call: WriteCall };

/** How wide an NFT approval is: one token (the default, ADR 0008) or the whole collection. */
export type NftScope = "token" | "collection";

/**
 * Whether `owner` can honour an intent that gives `give`, the way the pool and the contract will
 * check it: they hold everything, and ChogSwapIntents may move it (it holds nothing itself, the
 * approval is what lets a signed intent execute without another confirmation).
 *
 * `problems` are things an approval can't fix (not enough balance, not the owner). `steps` are
 * the approvals still missing: exact amounts for tokens, a single-token approval for NFTs unless
 * the maker chose to approve the collection. Run `steps[0]` and the list shrinks by itself,
 * because useTxFlow refetches every query after a write.
 */
export function useIntentReadiness(
  owner: Address | undefined,
  give: readonly Asset[],
  info: ReadonlyMap<string, TokenInfo>,
  scope: NftScope = "token",
) {
  const spender = CHOG_SWAP_INTENTS_ADDRESS;
  const tokens = useMemo(() => give.filter((a) => a.kind === "erc20"), [give]);
  const nfts = useMemo(() => give.filter((a) => a.kind === "erc721"), [give]);
  const collections = useMemo(() => [...new Set(nfts.map((a) => a.token))], [nfts]);

  const enabled = !!owner && !!spender && give.length > 0;
  const result = useReadContracts({
    contracts: [
      ...tokens.flatMap((a) => [
        { address: a.token, abi: erc20Abi, chainId: CHAIN_ID, functionName: "balanceOf", args: [owner!] },
        { address: a.token, abi: erc20Abi, chainId: CHAIN_ID, functionName: "allowance", args: [owner!, spender!] },
      ] as const),
      ...nfts.flatMap((a) => [
        { address: a.token, abi: erc721Abi, chainId: CHAIN_ID, functionName: "ownerOf", args: [a.id] },
        { address: a.token, abi: erc721Abi, chainId: CHAIN_ID, functionName: "getApproved", args: [a.id] },
      ] as const),
      ...collections.map(
        (token) =>
          ({ address: token, abi: erc721Abi, chainId: CHAIN_ID, functionName: "isApprovedForAll", args: [owner!, spender!] }) as const,
      ),
    ],
    query: { enabled },
  });

  return useMemo(() => {
    const data = result.data;
    if (!enabled || !owner || !spender || !data) return { steps: [] as ApprovalStep[], problems: [] as string[], isLoading: enabled && result.isLoading };

    const steps: ApprovalStep[] = [];
    const problems: string[] = [];
    const label = (a: Asset) => formatAsset(a, info.get(a.token.toLowerCase()));

    tokens.forEach((a, i) => {
      const balance = data[i * 2];
      const allowance = data[i * 2 + 1];
      if (balance?.status !== "success" || allowance?.status !== "success") {
        problems.push(`${a.token.slice(0, 6)}… isn't a readable token.`);
        return;
      }
      if ((balance.result as bigint) < a.amount) problems.push(`You hold less than ${label(a)}.`);
      if ((allowance.result as bigint) < a.amount) {
        steps.push({
          key: `erc20:${a.token}`,
          label: `Approve ${label(a)}`,
          call: { address: a.token, abi: erc20Abi, functionName: "approve", args: [spender, a.amount] },
        });
      }
    });

    const nftBase = tokens.length * 2;
    const allBase = nftBase + nfts.length * 2;
    const collectionApproved = (token: Address) => {
      const read = data[allBase + collections.indexOf(token)];
      return read?.status === "success" && read.result === true;
    };
    const collectionStepped = new Set<Address>();

    nfts.forEach((a, i) => {
      const ownerRead = data[nftBase + i * 2];
      const approvedRead = data[nftBase + i * 2 + 1];
      if (ownerRead?.status !== "success") {
        problems.push(`NFT #${a.id} of ${a.token.slice(0, 6)}… doesn't exist.`);
        return;
      }
      if (!sameAddress(ownerRead.result as Address, owner)) {
        problems.push(`You don't own NFT #${a.id} of ${a.token.slice(0, 6)}….`);
        return;
      }
      const approved = approvedRead?.status === "success" && sameAddress(approvedRead.result as Address, spender);
      if (approved || collectionApproved(a.token)) return;
      if (scope === "collection") {
        if (collectionStepped.has(a.token)) return;
        collectionStepped.add(a.token);
        steps.push({
          key: `nft-all:${a.token}`,
          label: `Approve NFT collection ${a.token.slice(0, 6)}…${a.token.slice(-4)}`,
          call: { address: a.token, abi: erc721Abi, functionName: "setApprovalForAll", args: [spender, true] },
        });
        return;
      }
      steps.push({
        key: `nft:${a.token}:${a.id}`,
        label: `Approve NFT #${a.id}`,
        call: { address: a.token, abi: erc721Abi, functionName: "approve", args: [spender, a.id] },
      });
    });

    return { steps, problems, isLoading: false };
  }, [result.data, result.isLoading, enabled, owner, spender, tokens, nfts, collections, info, scope]);
}
