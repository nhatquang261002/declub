import { standingsHandler } from "@/lib/server/rewardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/clubs/[token]/rewards/standings?wallet=   { enabled, standings }: the running epoch as if
 * it closed now (ADR 0032): fees so far, the Holder race and each Holder's bonus and estimate, and
 * the reader's own place.
 */
export const GET = standingsHandler(registry);
