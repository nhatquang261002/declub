import type { Registry } from "../verifiedAssets";
import { isScope } from "../timeline";
import { softViewer, type RouteDeps } from "./boardRoutes";
import { fail } from "./gate";
import { clubOf, type Ctx } from "./memberRoutes";
import { clientId, getStore, withinLimit } from "./store";
import { listSystem } from "./system";
import { timelineClubs } from "./timeline";
import type { Deps } from "./clubs";

/**
 * The routes behind system messages (ADR 0043). Public like the Boards they sit in, and cached
 * the same way: anyone anonymous shares one answer, and a reader who says who they are gets their
 * own Clubs (for the timeline's `joined`) without it being kept.
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

/** GET /api/timeline/system?scope=joined|others   { enabled, scope, events, since }: the same, across the Clubs a timeline scope reads. */
export function timelineSystemHandler(registry: Registry, deps: Pick<RouteDeps, "viewer"> & Deps = {}) {
  return async function GET(request: Request) {
    const asked = new URL(request.url).searchParams.get("scope") ?? "others";
    if (!isScope(asked)) return fail(400, "bad_request", "scope is joined or others.");
    const store = getStore();
    if (!store) return Response.json({ enabled: false, scope: asked, events: [], since: 0 }, { headers: OFF });
    // It reads every Club in the scope, so it is limited like the timeline itself.
    if (!(await withinLimit(store, "timeline-read", clientId(request), 120, 60))) return fail(429, "rate_limited", "Too many requests.");
    const viewer = await softViewer(request, deps);
    const clubs = await timelineClubs(store, registry, { userId: viewer?.id, scope: asked });
    const { events, since } = await listSystem(store, clubs, deps);
    return Response.json({ enabled: true, scope: asked, events, since }, { headers: { "Cache-Control": viewer ? "private, no-store" : SHARED } });
  };
}
