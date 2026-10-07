"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccessToken } from "@/hooks/useAccessToken";
import { read } from "@/hooks/useClubBoard";
import type { TimelineScope } from "@/lib/timeline";
import type { SystemEvent } from "@/lib/systemFeed";

const REFRESH_MS = 30_000;

type Answer = { enabled: boolean; events: SystemEvent[]; since: number };

/**
 * The system messages of one Club (`{ club }`) or of a timeline scope (`{ scope }`), for
 * `weave` to set among the posts (lib/systemFeed.ts). Without them the feed is only posts, so a
 * failure is quiet: there is nothing to retry or to tell the reader.
 */
export function useSystemMessages(from: { club: string } | { scope: TimelineScope }) {
  const getToken = useAccessToken();
  const idle = "scope" in from && from.scope === "joined" && !getToken;
  const path = "club" in from ? `/api/clubs/${from.club}/system` : `/api/timeline/system?scope=${from.scope}`;
  const query = useQuery({
    queryKey: ["system", "club" in from ? from.club.toLowerCase() : from.scope, !!getToken],
    enabled: !idle,
    queryFn: () => read<Answer>(path, "scope" in from ? getToken : undefined),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { events: query.data?.events ?? [], since: query.data?.since ?? Number.POSITIVE_INFINITY };
}
