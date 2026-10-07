import type { Registry } from "../verifiedAssets";
import { fail } from "./gate";
import { clubOf, type Ctx } from "./memberRoutes";
import { clientId, getStore, withinLimit } from "./store";
import { listSystem } from "./system";
import type { Deps } from "./clubs";

/**
 * The route behind system messages (ADR 0043). Public like the Board they sit in, and cached the
 * same way.
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
    const { events, since } = await listSystem(store, entry, deps);
    return Response.json({ enabled: true, events, since }, { headers: { "Cache-Control": SHARED } });
  };
}
