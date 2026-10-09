"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { CHAIN_ID, DECLUB_ESCROW_ADDRESS, DECLUB_INTENTS_ADDRESS } from "@/lib/config";
import { erc20Abi, erc721Abi } from "@/lib/contracts";
import type { WriteCall } from "./useTxFlow";

/** Which DeClub contract an approval is for: the escrow behind deals, or the signed-swap settler. */
export type Spender = "escrow" | "intents";

const SPENDERS: { key: Spender; address: Address | undefined }[] = [
  { key: "escrow", address: DECLUB_ESCROW_ADDRESS },
  { key: "intents", address: DECLUB_INTENTS_ADDRESS },
];

/** A contract to check: a collection (`setApprovalForAll`) or a token (`allowance`). */
export type ApprovalTarget = { token: Address; kind: "erc721" | "erc20" };

/** An approval still on: a whole collection, or a token allowance above zero. */
export type LiveApproval = ApprovalTarget & {
  spender: Spender;
  spenderAddress: Address;
  /** The allowance left, for a token. */
  amount?: bigint;
};

/** Turns an approval off: the collection approval cleared, or the allowance set to zero. */
export const revokeCall = (a: LiveApproval): WriteCall =>
  a.kind === "erc721"
    ? { address: a.token, abi: erc721Abi, functionName: "setApprovalForAll", args: [a.spenderAddress, false] }
    : { address: a.token, abi: erc20Abi, functionName: "approve", args: [a.spenderAddress, 0n] };

/**
 * Which of `targets` `owner` still lets a DeClub contract move (`spenders`, both by default). Only
 * contracts named here are read: the chain has no index of a wallet's approvals, so the caller
 * decides what to look at. Refetched after every write (useTxFlow), so a revoke drops its row.
 */
export function useApprovals(owner: Address | undefined, targets: readonly ApprovalTarget[], spenders: readonly Spender[] = ["escrow", "intents"]) {
  const pairs = useMemo(() => {
    const unique = [...new Map(targets.map((t) => [`${t.kind}:${t.token.toLowerCase()}`, t])).values()];
    return unique.flatMap((t) =>
      SPENDERS.filter((s) => spenders.includes(s.key) && s.address).map((s) => ({ ...t, spender: s.key, spenderAddress: s.address! })),
    );
  }, [targets, spenders]);

  const enabled = !!owner && pairs.length > 0;
  const result = useReadContracts({
    contracts: pairs.map((p) =>
      p.kind === "erc721"
        ? ({ address: p.token, abi: erc721Abi, chainId: CHAIN_ID, functionName: "isApprovedForAll", args: [owner!, p.spenderAddress] } as const)
        : ({ address: p.token, abi: erc20Abi, chainId: CHAIN_ID, functionName: "allowance", args: [owner!, p.spenderAddress] } as const),
    ),
    query: { enabled },
  });

  const approvals = useMemo<LiveApproval[]>(() => {
    if (!enabled || !result.data) return [];
    return pairs.flatMap((p, i) => {
      const read = result.data[i];
      if (read?.status !== "success") return [];
      if (p.kind === "erc721") return read.result === true ? [p] : [];
      const amount = read.result as bigint;
      return amount > 0n ? [{ ...p, amount }] : [];
    });
  }, [enabled, pairs, result.data]);

  return { approvals, isLoading: enabled && result.isLoading };
}
