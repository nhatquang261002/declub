import { timelineHandler } from "@/lib/server/timelineRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/timeline   { enabled, scope, posts, next }: Board posts from the reader's own Clubs
 * (`scope=joined`), every Club (`scope=all`) or every other Club (`scope=others`), newest first.
 * See ADR 0041.
 */
export const GET = timelineHandler(registry);
