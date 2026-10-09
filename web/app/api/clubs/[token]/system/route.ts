import { clubSystemHandler } from "@/lib/server/systemRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/clubs/[token]/system   { enabled, events, since }: the swaps, listings and joins of the
 * last week, for the Board to set among its posts as system messages. See ADR 0043.
 */
export const GET = clubSystemHandler(registry);
