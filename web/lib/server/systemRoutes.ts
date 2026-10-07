import type { Registry } from "../verifiedAssets";
import { softViewer, type RouteDeps } from "./boardRoutes";
import { fail } from "./gate";
import { clubOf, type Ctx } from "./memberRoutes";
import { clubsOf } from "./members";
import { clientId, getStore, withinLimit } from "./store";
import { listSystem } from "./system";
import type { Deps } from "./clubs";

/**
 * The routes behind system messages (ADR 0043). A Club's are public like its Board, and cached the
 * same way; the timeline's are the reader's own Clubs, so they are theirs alone.
 */
const SHARED = "public, s-maxage=15, stale-while-revalidate=60";
const OFF = { "Cache-Control": "no-store" };

/** GET /api/clubs/[token]/system   { enabled, events, since }: what happened in one Club lately. */
export function clubSystemHandler(registry: Registry, deps: Deps = {}) {
  return async function GET(request: Request, ctx: Ctx) {
    const entry = await clubOf(registry, ctx);
    if (entry instanceof Response) return entry;
    const store = getStore();
    if (!store) return Response.json({ enabled: false, events: [], since: 0 }, { headers: OFF });
    if (!(await withinLimit(store, "clubs-read", clientId(request), 240, 60))) return fail(429, "rate_limited", "Too many requests.");
    const { events, since } = await listSystem(store, [entry], deps);
    return Response.json({ enabled: true, events, since }, { headers: { "Cache-Control": SHARED } });
  };
}

/**
 * GET /api/timeline/system   { enabled, events, since }: the same, across the Clubs the reader has
 * joined, for their timeline. A reader who doesn't say who they are has none.
 */
export function timelineSystemHandler(registry: Registry, deps: Pick<RouteDeps, "viewer"> & Deps = {}) {
  return async function GET(request: Request) {
    const store = getStore();
    if (!store) return Response.json({ enabled: false, events: [], since: 0 }, { headers: OFF });
    // It reads every Club the reader is in, so it is limited like the timeline itself.
    if (!(await withinLimit(store, "timeline-read", clientId(request), 120, 60))) return fail(429, "rate_limited", "Too many requests.");
    const viewer = await softViewer(request, deps);
    const clubs = viewer ? (await clubsOf(store, viewer.id)).flatMap((token) => registry.clubFor(token) ?? []) : [];
    const { events, since } = await listSystem(store, clubs, deps);
    return Response.json({ enabled: true, events, since }, { headers: OFF });
  };
}
