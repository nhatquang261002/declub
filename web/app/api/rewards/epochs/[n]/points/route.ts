import { epochPointsHandler } from "@/lib/server/rewardRoutes";

/**
 * GET /api/rewards/epochs/[n]/points: every Holder's final points in a built epoch (ADR 0040), by
 * Club and public wallet, paid or not, with the rules used. 404 until the epoch is built.
 */
export const GET = epochPointsHandler();
