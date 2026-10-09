import { isAddress } from "viem";
import type { Registry } from "../verifiedAssets";
import { clubDetail, clubList, type Deps } from "./clubs";
import { clientId, getStore, withinLimit } from "./store";

/**
 * The Club read routes, built over a registry so the rules (which assets have a Club) can be
 * tested with a list of their own. The route files only bind the shipped registry.
 */
const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };
const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string, message: string) => Response.json({ error, message }, { status, headers: NO_STORE });

/** GET /api/clubs: every Club with its Momentum and counts, busiest first. */
export function listHandler(registry: Registry, deps: Deps = {}) {
  return async function GET(request: Request) {
    const store = getStore();
    if (store && !(await withinLimit(store, "clubs-read", clientId(request), 240, 60))) {
      return fail(429, "rate_limited", "Too many requests.");
    }
    const clubs = await clubList(store, registry.clubs(), deps);
    return Response.json({ logging: store !== null, clubs }, { headers: CACHE });
  };
}

/** GET /api/clubs/[token]: one Club's numbers and latest completed swaps, or 404. */
export function detailHandler(registry: Registry, deps: Deps = {}) {
  return async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
    // Blocked, unlisted and listed-without-a-Club assets all read the same: there is no Club.
    const entry = registry.clubFor(token);
    if (!entry) return fail(404, "not_found", "No Club for this asset.");
    const store = getStore();
    if (store && !(await withinLimit(store, "clubs-read", clientId(request), 240, 60))) {
      return fail(429, "rate_limited", "Too many requests.");
    }
    const detail = await clubDetail(store, entry, deps);
    return Response.json({ logging: store !== null, ...detail }, { headers: CACHE });
  };
}
