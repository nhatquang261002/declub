import { isScope, parseCursor, TIMELINE_MAX_PAGE, TIMELINE_PAGE } from "../timeline";
import type { Registry } from "../verifiedAssets";
import { softViewer, type RouteDeps } from "./boardRoutes";
import { fail } from "./gate";
import { clientId, getStore, withinLimit } from "./store";
import { listTimeline } from "./timeline";

/** The `limit` and `before` a page of posts is asked with (`before` is the `next` of the page before), or the 400 that says they're wrong. */
export function pageParams(url: URL) {
  const limit = url.searchParams.get("limit") === null ? TIMELINE_PAGE : Number(url.searchParams.get("limit"));
  const askedBefore = url.searchParams.get("before");
  const before = askedBefore === null ? undefined : parseCursor(askedBefore);
  if (!Number.isInteger(limit) || limit < 1 || limit > TIMELINE_MAX_PAGE || before === null) {
    return fail(400, "bad_request", `limit is 1 to ${TIMELINE_MAX_PAGE}, and before is the next of an earlier page.`);
  }
  return { limit, before };
}

/**
 * GET /api/timeline?scope=joined|all|others&limit=&before=   { enabled, scope, posts, next }: a page
 * of Board posts from many Clubs, newest first (ADR 0041). `before` is the `next` of the page before
 * (omit it for the first); `next` is null at the end, so the list is as long as the Boards are. Public like each Board; a reader who sends a
 * token also gets which posts they liked, and `joined` (the Clubs they belong to) is theirs alone.
 * `all` is every live Club (and the reader's own archived ones); `others` is every live Club the
 * reader hasn't joined, so an anonymous reader gets the same from both.
 */
export function timelineHandler(registry: Registry, deps: Pick<RouteDeps, "viewer"> = {}) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const asked = url.searchParams.get("scope") ?? "all";
    if (!isScope(asked)) return fail(400, "bad_request", "scope is joined, all or others.");
    const page = pageParams(url);
    if (page instanceof Response) return page;
    const { limit, before } = page;

    const store = getStore();
    if (!store) return Response.json({ enabled: false, scope: asked, posts: [], next: null }, { headers: { "Cache-Control": "no-store" } });
    // A read costs a few reads per Club, so it is limited more tightly than one Board.
    if (!(await withinLimit(store, "timeline-read", clientId(request), 120, 60))) return fail(429, "rate_limited", "Too many requests.");

    const viewer = await softViewer(request, deps);
    const { posts, next } = await listTimeline(store, registry, { userId: viewer?.id, scope: asked, limit, before });
    // Everyone shares one cached answer to `all` and `others` unless they said who they are (their
    // Clubs and likes change it); `joined` is theirs by definition.
    const cache = viewer ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=60";
    return Response.json({ enabled: true, scope: asked, posts, next }, { headers: { "Cache-Control": cache } });
  };
}
