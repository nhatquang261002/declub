import type { Registry } from "../verifiedAssets";
import { softViewer, type RouteDeps } from "./boardRoutes";
import { liveChallenges } from "./challenges";
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
 * GET /api/timeline/system?scope=joined|all   { enabled, events, since }: the same, across the
 * Clubs the reader has joined (`joined`, the default: theirs alone, and none for a reader who
 * doesn't say who they are), or across every live Club (`all`: public, and cached like a Club's).
 */
export function timelineSystemHandler(registry: Registry, deps: Pick<RouteDeps, "viewer"> & Deps = {}) {
  return async function GET(request: Request) {
    const scope = new URL(request.url).searchParams.get("scope") ?? "joined";
    if (scope !== "joined" && scope !== "all") return fail(400, "bad_request", "scope is joined or all.");
    const store = getStore();
    if (!store) return Response.json({ enabled: false, events: [], since: 0 }, { headers: OFF });
    // It reads every Club the reader is in, or every Club, so it is limited like the timeline itself.
    if (!(await withinLimit(store, "timeline-read", clientId(request), 120, 60))) return fail(429, "rate_limited", "Too many requests.");
    if (scope === "all") {
      // An archived Club's Board is frozen, so it has nothing new to tell.
      const { events, since } = await listSystem(store, registry.clubs().filter((club) => club.club !== "archived"), deps);
      return Response.json({ enabled: true, events, since }, { headers: { "Cache-Control": SHARED } });
    }
    const viewer = await softViewer(request, deps);
    const clubs = viewer ? (await clubsOf(store, viewer.id)).flatMap((token) => registry.clubFor(token) ?? []) : [];
    const { events, since } = await listSystem(store, clubs, deps);
    return Response.json({ enabled: true, events, since }, { headers: OFF });
  };
}

/**
 * GET /api/timeline/challenges?scope=joined|all   { enabled, challenges: [{ club, challenge }] }: the
 * challenges still running or waiting on their result, in the Clubs the reader has joined or in
 * every live Club, pinned on top of the timeline as they are on a Board (ADR 0045).
 */
export function timelineChallengesHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function GET(request: Request) {
    const scope = new URL(request.url).searchParams.get("scope") ?? "joined";
    if (scope !== "joined" && scope !== "all") return fail(400, "bad_request", "scope is joined or all.");
    const store = getStore();
    if (!store) return Response.json({ enabled: false, challenges: [] }, { headers: OFF });
    if (!(await withinLimit(store, "timeline-read", clientId(request), 120, 60))) return fail(429, "rate_limited", "Too many requests.");
    const viewer = await softViewer(request, deps);
    const clubs =
      scope === "all"
        ? registry.clubs().filter((club) => club.club !== "archived")
        : viewer
          ? (await clubsOf(store, viewer.id)).flatMap((token) => registry.clubFor(token) ?? [])
          : [];
    const challenges = await liveChallenges(store, clubs, { userId: viewer?.id }, deps);
    // A signed-in reader sees which entries are theirs, so theirs is not shared.
    return Response.json({ enabled: true, challenges }, { headers: viewer ? { "Cache-Control": "private, no-store" } : { "Cache-Control": SHARED } });
  };
}
