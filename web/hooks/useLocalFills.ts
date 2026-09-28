"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { CHAIN_ID, CHOG_SWAP_ADDRESS } from "@/lib/config";

// Who filled a public trade is only recorded in the TradeFilled event, and the public RPC
// can't scan logs from the deploy block (100-block cap). Until an indexer exists
// (ADR 0003), remember the trades this browser filled.

const EVENT = "chogswap:fills";
const key = (account: string) =>
  `chogswap:fills:${CHAIN_ID}:${CHOG_SWAP_ADDRESS}:${account.toLowerCase()}`;

function read(account: string | undefined): string {
  if (!account) return "[]";
  try {
    return localStorage.getItem(key(account)) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useLocalFills(account: Address | undefined) {
  // Snapshot is the raw string so React can compare it by value.
  const raw = useSyncExternalStore(
    subscribe,
    () => read(account),
    () => "[]",
  );

  const ids = parse(raw);

  const record = useCallback(
    (tradeId: bigint) => {
      if (!account) return;
      const next = new Set(parse(read(account)).map(String));
      next.add(tradeId.toString());
      try {
        localStorage.setItem(key(account), JSON.stringify([...next]));
        window.dispatchEvent(new Event(EVENT));
      } catch {
        // Storage unavailable (private mode); history just won't list this fill.
      }
    },
    [account],
  );

  return { ids, record };
}

function parse(raw: string): bigint[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((v) => /^\d+$/.test(v)).map((v) => BigInt(v)) : [];
  } catch {
    return [];
  }
}
