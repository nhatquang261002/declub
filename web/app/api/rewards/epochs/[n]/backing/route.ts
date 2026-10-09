import { epochBackingHandler } from "@/lib/server/rewardRoutes";

/**
 * GET /api/rewards/epochs/[n]/backing: who backed whom in a built epoch (ADR 0040), by Club and
 * public wallet, so anyone can recompute the points. 404 until the epoch is built.
 */
export const GET = epochBackingHandler();
