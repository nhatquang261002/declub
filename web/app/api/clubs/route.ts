import { listHandler } from "@/lib/server/clubRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/clubs   { logging, clubs }: every Club with its Momentum and counts, busiest first.
 *
 * Public, and cached for a short while: it is derived from on-chain activity. `logging` says
 * whether this server keeps the activity log; without it only signed swaps count (docs/09-clubs.md).
 */
export const GET = listHandler(registry);
