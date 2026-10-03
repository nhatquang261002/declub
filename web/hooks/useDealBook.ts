"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { bookParams, fromWireListings, type BookQuery, type BookResponse } from "@/lib/dealBook";

/**
 * One page of the deal book, searched and filtered by the server over every deal and signed swap
 * (`GET /api/deals`, ADR 0020). Polled like the chain reads it replaces, and the last page stays on
 * screen while the next one loads.
 */
export function useDealBook(query: BookQuery, { enabled = true }: { enabled?: boolean } = {}) {
  const params = bookParams(query).toString();
  const result = useQuery({
    queryKey: ["deal-book", params],
    enabled,
    refetchInterval: 8_000,
    placeholderData: keepPreviousData,
    retry: 1,
    queryFn: async ({ signal }): Promise<BookResponse> => {
      const response = await fetch(`/api/deals?${params}`, { signal });
      const body = (await response.json().catch(() => null)) as (BookResponse & { message?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.message ?? `The deals couldn't be loaded (${response.status}).`);
      return body;
    },
  });

  const data = result.data;
  const items = useMemo(() => (data?.enabled ? fromWireListings(data.items) : []), [data]);
  return {
    enabled: data?.enabled ?? true,
    items,
    total: data?.enabled ? data.total : 0,
    counts: data?.enabled ? data.counts : { open: 0, forYou: 0 },
    signedError: data?.enabled ? data.signedError : null,
    isLoading: result.isLoading,
    /** A new query is on its way; the page shown is the previous one. */
    isFetching: result.isPlaceholderData,
    error: result.error,
  };
}
