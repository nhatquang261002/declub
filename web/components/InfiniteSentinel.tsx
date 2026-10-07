"use client";

import { useEffect, useRef } from "react";
import { Spinner } from "@/components/Spinner";

/**
 * The end of an endless list: when it scrolls near the screen it asks for the next page, so the
 * list just keeps going. `count` is how much is loaded; it re-arms the watcher after each page, so
 * a page too short to fill the screen loads the next one too. A failed load shows a button instead
 * of retrying forever.
 */
export function InfiniteSentinel({
  hasMore,
  loading,
  count,
  failed = false,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  count: number;
  failed?: boolean;
  onLoadMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const load = useRef(onLoadMore);
  useEffect(() => {
    load.current = onLoadMore;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loading || failed || typeof IntersectionObserver === "undefined") return;
    // Start loading a screen or so before the end, so there is rarely a wait.
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load.current(), { rootMargin: "800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, failed, count]);

  if (!hasMore) return null;
  return (
    <div ref={ref} className="mt-5 flex min-h-10 items-center justify-center" role="status" aria-live="polite">
      {failed ? (
        <button type="button" className="btn-secondary" onClick={onLoadMore}>
          Couldn’t load more. Try again
        </button>
      ) : loading ? (
        <span className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading more posts…
        </span>
      ) : null}
    </div>
  );
}
