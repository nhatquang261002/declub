"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { CHAIN_ID, ON_DEAL_INTENTS_ADDRESS } from "@/lib/config";
import { getInfo, getIntent, listIntents, listSettlements, type ListParams } from "@/lib/pool";

// Reads of the intent pool (matcher/). Polled, since the pool has no push channel. A pool that is
// down is an ordinary error state here, not an exception: nothing on-chain depends on it.

const POLL_MS = 5_000;

/** Whether the pool answers, and whether it is for the chain and contract this app is on. */
export function usePoolInfo() {
  const query = useQuery({ queryKey: ["pool", "info"], queryFn: getInfo, retry: false, refetchInterval: 30_000 });
  const info = query.data;
  const mismatch =
    !!info &&
    (info.chainId !== CHAIN_ID || info.swap.toLowerCase() !== ON_DEAL_INTENTS_ADDRESS?.toLowerCase());
  return { info, mismatch, isLoading: query.isLoading, error: query.error };
}

/** The pool's book, newest first. */
export function useIntents(params: ListParams & { enabled?: boolean } = {}) {
  const { enabled = true, ...list } = params;
  const query = useQuery({
    queryKey: ["pool", "intents", list.status ?? "open", list.maker?.toLowerCase() ?? null, list.limit ?? null, list.token?.toLowerCase() ?? null],
    queryFn: () => listIntents(list),
    enabled: enabled && !!ON_DEAL_INTENTS_ADDRESS,
    refetchInterval: POLL_MS,
    retry: 1,
  });
  return { intents: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

export function useIntent(hash: Hex | undefined) {
  const query = useQuery({
    queryKey: ["pool", "intent", hash],
    queryFn: () => getIntent(hash!),
    enabled: !!hash && !!ON_DEAL_INTENTS_ADDRESS,
    refetchInterval: POLL_MS,
    retry: 1,
  });
  return { row: query.data ?? null, isLoading: query.isLoading, error: query.error };
}

/** Settled cycles, newest first. Pass `maker` for the ones a wallet was part of. */
export function useSettlements({ maker, enabled = true }: { maker?: Address; enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: ["pool", "settlements", maker?.toLowerCase() ?? null],
    queryFn: () => listSettlements({ maker }),
    enabled: enabled && !!ON_DEAL_INTENTS_ADDRESS,
    refetchInterval: POLL_MS,
    retry: 1,
  });
  return { settlements: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
