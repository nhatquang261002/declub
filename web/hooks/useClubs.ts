"use client";

import { useQuery } from "@tanstack/react-query";
import type { ClubDetail, ClubSummary } from "@/lib/clubs";

// Clubs' numbers come from the server (docs/09-clubs.md). The list of Clubs itself is static, so
// a page can draw itself before these arrive, or without them: an unreachable server only costs
// Momentum and the recent swaps.

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : `The server answered ${res.status}.`);
  }
  return body as T;
}

const REFRESH_MS = 30_000;

/** Every Club with its Momentum and counts, busiest first. */
export function useClubs() {
  const query = useQuery({
    queryKey: ["clubs"],
    queryFn: () => getJson<{ logging: boolean; clubs: ClubSummary[] }>("/api/clubs"),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { clubs: query.data?.clubs, logging: query.data?.logging, isLoading: query.isLoading, error: query.error };
}

/** One Club's numbers and its latest completed swaps. */
export function useClub(token: string) {
  const query = useQuery({
    queryKey: ["clubs", token.toLowerCase()],
    queryFn: () => getJson<ClubDetail & { logging: boolean }>(`/api/clubs/${token}`),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return {
    club: query.data?.club,
    recent: query.data?.recent ?? [],
    holders: query.data?.holders ?? 0,
    logging: query.data?.logging,
    isLoading: query.isLoading,
    error: query.error,
  };
}
