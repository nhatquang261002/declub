import { purgeHandler } from "@/lib/server/boardRoutes";
import { detailHandler } from "@/lib/server/clubRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/clubs/[token]   { logging, club, recent }: one Club's Momentum and counts, and its
 * latest completed swaps. 404 for an address that has no Club (not on the verified list, listed
 * without one, or blocked).
 */
export const GET = detailHandler(registry);

/**
 * DELETE /api/clubs/[token]: delete everything stored for a Club that is hidden from the list
 * (blocked, or no longer on it). App admins only; a live Club is refused.
 */
export const DELETE = purgeHandler(registry);
