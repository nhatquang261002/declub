import { timelineSystemHandler } from "@/lib/server/systemRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/timeline/system   { enabled, events, since }: the swaps, listings and joins of the last
 * week in the Clubs the reader has joined, for the timeline. See ADR 0043.
 */
export const GET = timelineSystemHandler(registry);
