"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import type { Address, Hex } from "viem";
import { CHAIN_ID, ON_DEAL_INTENTS_ADDRESS } from "@/lib/config";
import { DEMO_DEALS, demoIntents, demoSettlements } from "@/lib/demoDeals";
import { isLive, type PoolIntent } from "@/lib/intents";
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
  const { address } = useConnection();
  const mock = useMemo(
    () => (enabled && DEMO_DEALS ? demoIntents(address).filter((row) => matches(row, list)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `list` is rebuilt every render; its fields are the deps.
    [enabled, address, list.status, list.maker, list.token],
  );
  const query = useQuery({
    queryKey: ["pool", "intents", list.status ?? "open", list.maker?.toLowerCase() ?? null, list.limit ?? null, list.token?.toLowerCase() ?? null],
    queryFn: () => listIntents(list),
    enabled: enabled && !!ON_DEAL_INTENTS_ADDRESS && !DEMO_DEALS,
    refetchInterval: POLL_MS,
    retry: 1,
  });
  if (mock) return { intents: mock.slice(0, list.limit ?? mock.length), isLoading: false, error: null };
  return { intents: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

/** The pool's filters, applied to mock rows: "open" is everything still live. */
function matches(row: PoolIntent, list: ListParams): boolean {
  const status = list.status ?? "open";
  if (status === "open" ? !isLive(row.status) : status !== "all" && row.status !== status) return false;
  if (list.maker && row.intent.maker.toLowerCase() !== list.maker.toLowerCase()) return false;
  if (list.token) {
    const token = list.token.toLowerCase();
    if (![...row.intent.give, ...row.intent.want].some((a) => a.token.toLowerCase() === token)) return false;
  }
  return true;
}

export function useIntent(hash: Hex | undefined) {
  const { address } = useConnection();
  const mock = useMemo(
    () => (DEMO_DEALS && hash ? demoIntents(address).find((row) => row.hash.toLowerCase() === hash.toLowerCase()) : undefined),
    [hash, address],
  );
  const query = useQuery({
    queryKey: ["pool", "intent", hash],
    queryFn: () => getIntent(hash!),
    enabled: !!hash && !!ON_DEAL_INTENTS_ADDRESS && !mock,
    refetchInterval: POLL_MS,
    retry: 1,
  });
  if (mock) return { row: mock, isLoading: false, error: null };
  return { row: query.data ?? null, isLoading: query.isLoading, error: query.error };
}

/** Settled cycles, newest first. Pass `maker` for the ones a wallet was part of. */
export function useSettlements({ maker, enabled = true }: { maker?: Address; enabled?: boolean } = {}) {
  const { address } = useConnection();
  const mock = useMemo(
    () =>
      enabled && DEMO_DEALS
        ? demoSettlements(address).filter((s) => !maker || s.cycle.some((r) => r.intent.maker.toLowerCase() === maker.toLowerCase()))
        : null,
    [enabled, maker, address],
  );
  const query = useQuery({
    queryKey: ["pool", "settlements", maker?.toLowerCase() ?? null],
    queryFn: () => listSettlements({ maker }),
    enabled: enabled && !!ON_DEAL_INTENTS_ADDRESS && !DEMO_DEALS,
    refetchInterval: POLL_MS,
    retry: 1,
  });
  if (mock) return { settlements: mock, isLoading: false, error: null };
  return { settlements: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
