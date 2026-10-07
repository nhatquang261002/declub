"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccessToken } from "@/hooks/useAccessToken";
import { read } from "@/hooks/useClubBoard";
import type { SystemEvent } from "@/lib/systemFeed";

const REFRESH_MS = 30_000;

type Answer = { enabled: boolean; events: SystemEvent[]; since: number };

/**
 * The system messages of one Club's Board (`{ club }`), or of the reader's own Clubs for the
 * timeline (`"timeline"`, which needs them signed in), for `weave` to set among the posts
 * (lib/systemFeed.ts). Without them the feed is only posts, so a failure is quiet: there is nothing
 * to retry or to tell the reader.
 */
export function useSystemMessages(from: { club: string } | "timeline") {
  const getToken = useAccessToken();
  const timeline = from === "timeline";
  const query = useQuery({
    queryKey: ["system", timeline ? "timeline" : from.club.toLowerCase(), timeline && !!getToken],
    enabled: !timeline || !!getToken,
    queryFn: () => (timeline ? read<Answer>("/api/timeline/system", getToken) : read<Answer>(`/api/clubs/${from.club}/system`)),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { events: query.data?.events ?? [], since: query.data?.since ?? Number.POSITIVE_INFINITY };
}
