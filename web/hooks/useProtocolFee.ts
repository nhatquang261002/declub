"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { swapIntents, swapV2 } from "@/lib/contracts";

// The protocol fee (ADR 0015) is immutable in both contracts, so it is read from them and never
// from config: a wrong number in an env file would make every deal fail, or quote the wrong fee.
// `fee` stays undefined while loading and when the read fails, and the screens that need it
// keep their buttons off until it is known.

/**
 * What each side of a OnDealV2 deal sends, in MON, on top of the native amount in its assets.
 * The contract holds it with that side's escrow, pays it out only when the deal completes and
 * hands it back otherwise.
 */
export function useEscrowFee() {
  const result = useReadContracts({
    contracts: swapV2 ? [{ ...swapV2, functionName: "FEE" } as const] : [],
    query: { enabled: !!swapV2, staleTime: Infinity },
  });
  const read = result.data?.[0];
  const fee = read?.status === "success" ? read.result : undefined;
  return { fee, isLoading: result.isLoading, failed: !!swapV2 && !result.isLoading && fee === undefined };
}

export type IntentFee = { token: Address; amount: bigint };

/**
 * What each maker in a settled OnDealIntents cycle pays, in the wrapped-MON token, from their
 * wallet. It is also signed into every intent.
 */
export function useIntentFee() {
  const result = useReadContracts({
    contracts: swapIntents
      ? ([
          { ...swapIntents, functionName: "FEE_TOKEN" },
          { ...swapIntents, functionName: "FEE_AMOUNT" },
        ] as const)
      : [],
    query: { enabled: !!swapIntents, staleTime: Infinity },
  });
  const token = result.data?.[0];
  const amount = result.data?.[1];
  const tokenAddress = token?.status === "success" ? token.result : undefined;
  const feeAmount = amount?.status === "success" ? amount.result : undefined;
  // Stable between renders: the readiness hook depends on it.
  const fee = useMemo<IntentFee | undefined>(
    () => (tokenAddress !== undefined && feeAmount !== undefined ? { token: tokenAddress, amount: feeAmount } : undefined),
    [tokenAddress, feeAmount],
  );
  return { fee, isLoading: result.isLoading, failed: !!swapIntents && !result.isLoading && fee === undefined };
}
