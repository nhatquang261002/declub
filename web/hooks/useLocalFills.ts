"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { CHAIN_ID } from "@/lib/config";

// This browser's own record of the deals it filled. It is History's data only when the server
// store is off (ADR 0012, hooks/useFills.ts): who filled a public deal is recorded only in the
// TradeFilled event, and the public RPC can't scan logs from the deploy block (100-block cap).

const EVENT = "declub:fills";
const key = (contract: string, account: string) =>
  `declub:fills:${CHAIN_ID}:${contract}:${account.toLowerCase()}`;

function read(contract: string | undefined, account: string | undefined): string {
  if (!contract || !account) return "[]";
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

/** Fills are recorded per swap contract, so deal ids from different deployments don't mix. */
export function useLocalFills(account: Address | undefined, contract: Address | undefined) {
  // Snapshot is the raw string so React can compare it by value.
  const raw = useSyncExternalStore(
    subscribe,
    () => read(contract, account),
    () => "[]",
  );

  const ids = parse(raw);

  const record = useCallback(
    (dealId: bigint) => {
      if (!contract || !account) return;
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
