import { epochHandler } from "@/lib/server/rewardRoutes";

/**
 * GET /api/rewards/epochs/[n]: a built rewards epoch (ADR 0022): its window, root, total, each
 * Club's fees and pools, and every leaf with its proof, so anyone can rebuild the root and check
 * it against DeClubRewards. 404 until the epoch is built.
 */
export const GET = epochHandler();
