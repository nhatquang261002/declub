import { timelineSystemHandler } from "@/lib/server/systemRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/timeline/system?scope=joined|all   { enabled, events, since }: the swaps, listings and
 * joins of the last week in the Clubs the reader has joined, or in every live Club, for the
 * timeline. See ADR 0043.
 */
export const GET = timelineSystemHandler(registry);
