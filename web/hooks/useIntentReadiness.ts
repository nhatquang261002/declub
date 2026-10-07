"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { CHAIN_ID, DECLUB_INTENTS_ADDRESS } from "@/lib/config";
import { erc20Abi, erc721Abi, wmonAbi } from "@/lib/contracts";
import { erc20Asset, feeUnits, formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { sameAddress } from "@/lib/deals";
import { formatMon } from "@/lib/format";
import type { IntentFee } from "./useProtocolFee";
import type { WriteCall } from "./useTxFlow";

export type ApprovalStep = { key: string; label: string; call: WriteCall };

/** How wide an NFT approval is: one token (the default, ADR 0008) or the whole collection. */
export type NftScope = "token" | "collection";

/**
 * Whether `owner` can honour an intent that gives `give`, the way the pool and the contract will
 * check it: they hold everything, and DeClubIntents may move it (it holds nothing itself, the
 * approval is what lets a signed intent execute without another confirmation).
 *
 * `problems` are things an approval can't fix (not enough balance, not the owner). `steps` are
 * the approvals still missing: exact amounts for tokens, a single-token approval for NFTs unless
 * the maker chose to approve the collection. Run `steps[0]` and the list shrinks by itself,
 * because useTxFlow refetches every query after a write.
 *
 * `fee` is the protocol fee per NFT given: `settle` takes it, times the NFTs in `give` (once if
 * none), from the maker's wallet in the fee token, after the gives move (ADR 0015, 0033). It is counted on top of whatever the maker gives of that same token. A
 * maker short of the fee token but holding enough MON gets a "wrap" step first, so someone with
 * only MON never has to find WMON elsewhere.
 */
export function useIntentReadiness(
  owner: Address | undefined,
  give: readonly Asset[],
  info: ReadonlyMap<string, TokenInfo>,
  scope: NftScope = "token",
  fee?: IntentFee,
) {
  const spender = DECLUB_INTENTS_ADDRESS;
  const feeToken = useMemo(
    () => (fee && fee.amount > 0n ? { token: fee.token, amount: fee.amount * feeUnits(give) } : undefined),
    [fee, give],
  );
  // Every ERC-20 the wallet has to hold and approve: what it gives, plus the fee token. When the
  // fee token is also given, one approval has to cover both.
  const needs = useMemo(() => {
    const out = give
      .filter((a) => a.kind === "erc20")
      .map((a) => ({ token: a.token, give: a.amount, fee: feeToken && sameAddress(a.token, feeToken.token) ? feeToken.amount : 0n }));
    if (feeToken && !out.some((n) => sameAddress(n.token, feeToken.token))) {
      out.push({ token: feeToken.token, give: 0n, fee: feeToken.amount });
    }
    return out;
  }, [give, feeToken]);
  const nfts = useMemo(() => give.filter((a) => a.kind === "erc721"), [give]);
  const collections = useMemo(() => [...new Set(nfts.map((a) => a.token))], [nfts]);

  const enabled = !!owner && !!spender && give.length > 0;
  // Native MON, only to offer wrapping it into the fee token.
  const native = useBalance({ address: owner, chainId: CHAIN_ID, query: { enabled: enabled && !!feeToken } });
  const result = useReadContracts({
    contracts: [
      ...needs.flatMap((n) => [
        { address: n.token, abi: erc20Abi, chainId: CHAIN_ID, functionName: "balanceOf", args: [owner!] },
        { address: n.token, abi: erc20Abi, chainId: CHAIN_ID, functionName: "allowance", args: [owner!, spender!] },
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

    needs.forEach((n, i) => {
      const balance = data[i * 2];
      const allowance = data[i * 2 + 1];
      if (balance?.status !== "success" || allowance?.status !== "success") {
        problems.push(`${n.token.slice(0, 6)}… isn't a readable token.`);
        return;
      }
      const total = n.give + n.fee;
      const asset = erc20Asset(n.token, total);
      const symbol = info.get(n.token.toLowerCase())?.symbol ?? "WMON";
      const withFee = n.fee > 0n ? " (with the protocol fee)" : "";
      if ((balance.result as bigint) < total) {
        const shortfall = total - (balance.result as bigint);
        const mon = native.data?.value;
        if (n.fee > 0n && mon !== undefined && mon >= shortfall) {
          steps.push({
            key: `wrap:${n.token}`,
            label: `Wrap ${formatMon(shortfall)} into ${symbol}`,
            call: { address: n.token, abi: wmonAbi, functionName: "deposit", args: [], value: shortfall },
          });
        } else {
          problems.push(`You hold less than ${label(asset)}${withFee}.`);
        }
      }
      if ((allowance.result as bigint) < total) {
        steps.push({
          key: `erc20:${n.token}`,
          label: n.give === 0n ? `Approve ${label(asset)} for the protocol fee` : `Approve ${label(asset)}${withFee}`,
          call: { address: n.token, abi: erc20Abi, functionName: "approve", args: [spender, total] },
        });
      }
    });

    const nftBase = needs.length * 2;
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
  }, [result.data, result.isLoading, enabled, owner, spender, needs, nfts, collections, info, scope, native.data?.value]);
}
