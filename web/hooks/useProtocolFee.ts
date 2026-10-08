"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { swapIntents, swapEscrow } from "@/lib/contracts";

// The protocol fee (ADR 0015) is read from the contracts and never from config: a wrong number in
// an env file would make every deal fail, or quote the wrong fee. A fee admin can change it
// (ADR 0018): a cut applies at once and a raise is queued for 7 days, so it is re-read now and
// then rather than cached for good. `fee` stays undefined while loading and when the read fails,
// and the screens that need it keep their buttons off until it is known.
//
// These hooks are for something new: a listing, or an intent about to be signed. An escrow deal
// that already exists pays its own `deal.fee`, fixed when it was listed.

const STALE_MS = 60_000;

/** A raise the fee admin has queued: `amount` applies from `at` (unix seconds) at the earliest. */
export type PendingFee = { amount: bigint; at: bigint };

const pendingOf = (amount: bigint | undefined, at: bigint | undefined): PendingFee | undefined =>
  amount !== undefined && at !== undefined && at !== 0n ? { amount, at } : undefined;

/**
 * What each side of a new DeClubEscrow deal sends, in MON, on top of the native amount in its assets.
 * The contract holds it with that side's escrow, pays it out only when the deal completes and
 * hands it back otherwise.
 */
export function useEscrowFee() {
  const result = useReadContracts({
    contracts: swapEscrow
      ? ([
          { ...swapEscrow, functionName: "fee" },
          { ...swapEscrow, functionName: "pendingFee" },
          { ...swapEscrow, functionName: "pendingFeeAt" },
        ] as const)
      : [],
    query: { enabled: !!swapEscrow, staleTime: STALE_MS },
  });
  const [feeRead, pendingRead, atRead] = result.data ?? [];
  const fee = feeRead?.status === "success" ? feeRead.result : undefined;
  const pendingAmount = pendingRead?.status === "success" ? pendingRead.result : undefined;
  const pendingAt = atRead?.status === "success" ? atRead.result : undefined;
  const pending = useMemo(() => pendingOf(pendingAmount, pendingAt), [pendingAmount, pendingAt]);
  return { fee, pending, isLoading: result.isLoading, failed: !!swapEscrow && !result.isLoading && fee === undefined };
}

export type IntentFee = { token: Address; amount: bigint };

/**
 * What each maker in a settled DeClubIntents cycle pays right now, in the wrapped-MON token, from
 * their wallet. A new intent signs it as its `maxFee`.
 */
export function useIntentFee() {
  const result = useReadContracts({
    contracts: swapIntents
      ? ([
          { ...swapIntents, functionName: "FEE_TOKEN" },
          { ...swapIntents, functionName: "fee" },
          { ...swapIntents, functionName: "pendingFee" },
          { ...swapIntents, functionName: "pendingFeeAt" },
        ] as const)
      : [],
    query: { enabled: !!swapIntents, staleTime: STALE_MS },
  });
  const [tokenRead, feeRead, pendingRead, atRead] = result.data ?? [];
  const tokenAddress = tokenRead?.status === "success" ? tokenRead.result : undefined;
  const feeAmount = feeRead?.status === "success" ? feeRead.result : undefined;
  const pendingAmount = pendingRead?.status === "success" ? pendingRead.result : undefined;
  const pendingAt = atRead?.status === "success" ? atRead.result : undefined;
  // Stable between renders: the readiness hook depends on it.
  const fee = useMemo<IntentFee | undefined>(
    () => (tokenAddress !== undefined && feeAmount !== undefined ? { token: tokenAddress, amount: feeAmount } : undefined),
    [tokenAddress, feeAmount],
  );
  const pending = useMemo(() => pendingOf(pendingAmount, pendingAt), [pendingAmount, pendingAt]);
  return { fee, pending, isLoading: result.isLoading, failed: !!swapIntents && !result.isLoading && fee === undefined };
}
