"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { SearchHit, SearchKind } from "@/lib/search";

export type AssetSearchQuery = {
  query: string;
  /** The wallet whose holdings come first. */
  owner?: Address;
  kind: SearchKind;
  scope: "holdings" | "all";
};

type Answer = { hits: SearchHit[]; source: "moralis" | "chain"; degraded: boolean };

/** A value that follows `value` once it has held still for `ms`, so a search doesn't fire per keystroke. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Tokens or NFT collections by name, symbol or address, holdings first (`GET /api/search`, ADR 0027).
 * The last answer stays on screen while the next one loads. An error just means no results from the
 * server: the callers have local candidates of their own.
 */
export function useAssetSearch({ query, owner, kind, scope }: AssetSearchQuery) {
  const params = new URLSearchParams({ q: query.trim(), kind, scope });
  if (owner) params.set("owner", owner);
  const result = useQuery({
    queryKey: ["asset-search", params.toString()],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: 1,
    queryFn: async ({ signal }): Promise<Answer> => {
      const response = await fetch(`/api/search?${params}`, { signal });
      if (!response.ok) throw new Error(`Search failed (${response.status}).`);
      return (await response.json()) as Answer;
    },
  });
  return {
    hits: result.data?.hits ?? [],
    source: result.data?.source,
    degraded: result.data?.degraded ?? false,
    isLoading: result.isLoading,
    /** The list shown is the previous query's while this one loads. */
    isStale: result.isPlaceholderData,
    failed: result.isError,
  };
}
