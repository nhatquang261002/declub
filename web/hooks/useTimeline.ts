"use client";

import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query";
import { useAccessToken } from "@/hooks/useAccessToken";
import { read } from "@/hooks/useClubBoard";
import { TIMELINE_PAGE, type TimelinePost, type TimelineScope } from "@/lib/timeline";

const REFRESH_MS = 30_000;

/**
 * One page at a time of the timeline (ADR 0041): Board posts from the Clubs the reader belongs to
 * (`joined`), from every Club (`all`) or from every other Club (`others`). `joined` needs a signed-in reader and stays idle
 * without one. Posts and likes are the Boards' own, so a like or reply made here refreshes this.
 */
export function useTimeline(scope: TimelineScope) {
  const getToken = useAccessToken();
  const idle = scope === "joined" && !getToken;
  const query = useInfiniteQuery({
    queryKey: ["timeline", scope, !!getToken],
    // Each page starts after the post the last one ended on (`next`), so the list can go on as far as the Boards do.
    initialPageParam: null as string | null,
    enabled: !idle,
    queryFn: ({ pageParam }) =>
      read<TimelinePage>(
        `/api/timeline?${new URLSearchParams({ scope, limit: String(TIMELINE_PAGE), ...(pageParam ? { before: pageParam } : {}) })}`,
        getToken,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { ...timelineView(query), isLoading: !idle && query.isLoading };
}

export type TimelinePage = { enabled: boolean; posts: TimelinePost[]; next: string | null };

/** What the timeline's cards want from a paged query of {@link TimelinePost}s, each shown once. */
export function timelineView(query: UseInfiniteQueryResult<InfiniteData<TimelinePage>>) {
  const pages = query.data?.pages ?? [];
  // A post that arrives between two pages shifts the next one by a row; show each post once.
  const posts = [...new Map(pages.flatMap((page) => page.posts).map((post) => [`${post.club}:${post.id}`, post])).values()];
  return {
    enabled: pages[0]?.enabled !== false,
    posts,
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    isLoading: query.isLoading,
    error: query.error,
    /** The next page failed, with earlier ones still shown. */
    loadMoreFailed: query.isFetchNextPageError,
  };
}
