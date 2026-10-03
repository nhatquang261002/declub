"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import { CHAIN_ID } from "@/lib/config";
import { erc20Tokens, type TokenInfo } from "@/lib/assets";
import { DEMO_DEALS, demoTokenInfo } from "@/lib/demoDeals";
import type { DealV2 } from "@/lib/dealsV2";

/**
 * Symbol and decimals read from each token contract. Anyone can list any ERC-20 in V2, so the
 * UI must show what the token says about itself, never a label chosen by the deal's maker.
 * Tokens that don't answer are left out, and the UI falls back to the short address.
 */
export function useTokenInfo(tokens: readonly Address[]) {
  const result = useReadContracts({
    contracts: tokens.flatMap((address) => [
      { address, abi: erc20Abi, chainId: CHAIN_ID, functionName: "symbol" },
      { address, abi: erc20Abi, chainId: CHAIN_ID, functionName: "decimals" },
    ] as const),
    query: { enabled: tokens.length > 0, staleTime: Infinity },
  });

  const info = useMemo(() => {
    const out = new Map<string, TokenInfo>();
    tokens.forEach((token, i) => {
      // Mock tokens (lib/demoDeals.ts) have no contract to answer.
      const mock = DEMO_DEALS ? demoTokenInfo(token) : undefined;
      if (mock) return void out.set(token.toLowerCase(), mock);
      const symbol = result.data?.[i * 2];
      const decimals = result.data?.[i * 2 + 1];
      if (symbol?.status === "success" && decimals?.status === "success") {
        out.set(token.toLowerCase(), {
          symbol: String(symbol.result).slice(0, 12),
          decimals: Number(decimals.result),
        });
      }
    });
    return out;
  }, [result.data, tokens]);

  return { info, isLoading: result.isLoading };
}

/** `useTokenInfo` for every ERC-20 that appears in a list of V2 deals. */
export function useDealsTokenInfo(deals: readonly DealV2[]) {
  const tokens = useMemo(
    () => erc20Tokens(deals.flatMap((t) => [...t.offered, ...t.requested])),
    [deals],
  );
  return useTokenInfo(tokens);
}
