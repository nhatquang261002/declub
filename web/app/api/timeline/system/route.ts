import { timelineSystemHandler } from "@/lib/server/systemRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/timeline/system?scope=joined|others   { enabled, scope, events, since }: the same
 * messages across many Clubs, for the timeline. See ADR 0043.
 */
export const GET = timelineSystemHandler(registry);
