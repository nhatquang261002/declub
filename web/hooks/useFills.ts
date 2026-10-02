"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { CHAIN_ID, ON_DEAL_ADDRESS } from "@/lib/config";
import { useLocalFills } from "./useLocalFills";

type FillsResponse = { enabled: false } | { enabled: true; ids: string[] };

/**
 * The deals a wallet has filled, for History (ADR 0012). With the server store on, this is the
 * server's record: every fill the app reported after checking its receipt, the same on every
 * device (`reportTx`, called from useTxFlow). Without it, it is this browser's own record, as
 * before (hooks/useLocalFills.ts), and `record` is how a page adds to it.
 */
export function useFills(account: Address | undefined, contract: Address = ON_DEAL_ADDRESS) {
  const local = useLocalFills(account, contract);
  const query = useQuery({
    queryKey: ["fills", CHAIN_ID, contract.toLowerCase(), account?.toLowerCase()],
    enabled: !!account,
    staleTime: 15_000,
    retry: false,
    queryFn: async (): Promise<FillsResponse> => {
      const response = await fetch(`/api/fills?account=${account}&contract=${contract}`);
      return response.ok ? ((await response.json()) as FillsResponse) : { enabled: false };
    },
  });

  const serverIds = query.data?.enabled ? query.data.ids : undefined;
  const ids = useMemo(() => (serverIds ? serverIds.map((id) => BigInt(id)) : local.ids), [serverIds, local.ids]);

  const { record: recordLocal } = local;
  // With the server on, the transaction that made the fill is what records it; only the
  // browser-only mode needs a page to say so.
  const record = useCallback((dealId: bigint) => (serverIds ? undefined : recordLocal(dealId)), [serverIds, recordLocal]);

  return { ids, record };
}
