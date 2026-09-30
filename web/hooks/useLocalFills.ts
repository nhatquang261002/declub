"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { CHAIN_ID, CHOG_SWAP_ADDRESS } from "@/lib/config";

// Who filled a public deal is only recorded in the TradeFilled event, and the public RPC
// can't scan logs from the deploy block (100-block cap). Until an indexer exists
// (ADR 0003), remember the deals this browser filled.

const EVENT = "chogswap:fills";
const key = (contract: string, account: string) =>
  `chogswap:fills:${CHAIN_ID}:${contract}:${account.toLowerCase()}`;

function read(contract: string, account: string | undefined): string {
  if (!account) return "[]";
  try {
    return localStorage.getItem(key(contract, account)) ?? "[]";
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

/** Fills are recorded per swap contract, so v1 and V2 deal ids don't mix. Defaults to v1. */
export function useLocalFills(account: Address | undefined, contract: Address = CHOG_SWAP_ADDRESS) {
  // Snapshot is the raw string so React can compare it by value.
  const raw = useSyncExternalStore(
    subscribe,
    () => read(contract, account),
    () => "[]",
  );

  const ids = parse(raw);

  const record = useCallback(
    (dealId: bigint) => {
      if (!account) return;
      const next = new Set(parse(read(contract, account)).map(String));
      next.add(dealId.toString());
      try {
        localStorage.setItem(key(contract, account), JSON.stringify([...next]));
        window.dispatchEvent(new Event(EVENT));
      } catch {
        // Storage unavailable (private mode); history just won't list this fill.
      }
    },
    [account, contract],
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
