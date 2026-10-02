import { membersHandler } from "@/lib/server/memberRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/clubs/[token]/members?sort=momentum|new   { enabled, members, total, holders }: the
 * Club's leaderboard. Public, so no one's user id appears: a member is their displayed wallet.
 */
export const GET = membersHandler(registry);
