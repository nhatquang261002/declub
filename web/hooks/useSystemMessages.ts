"use client";

import { useQuery } from "@tanstack/react-query";
import { read } from "@/hooks/useClubBoard";
import type { SystemEvent } from "@/lib/systemFeed";

const REFRESH_MS = 30_000;

type Answer = { enabled: boolean; events: SystemEvent[]; since: number };

/**
 * A Club's system messages, for `weave` to set among its Board's posts (lib/systemFeed.ts).
 * Without them the Board is only posts, so a failure is quiet: there is nothing to retry or to
 * tell the reader.
 */
export function useSystemMessages(club: string) {
  const query = useQuery({
    queryKey: ["system", club.toLowerCase()],
    queryFn: () => read<Answer>(`/api/clubs/${club}/system`),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { events: query.data?.events ?? [], since: query.data?.since ?? Number.POSITIVE_INFINITY };
}
