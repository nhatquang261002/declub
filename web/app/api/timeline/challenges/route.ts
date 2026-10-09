import { timelineChallengesHandler } from "@/lib/server/systemRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/timeline/challenges?scope=joined|all[&past=1]   { enabled, challenges }: the challenges
 * still running in the Clubs the reader has joined, or in every live Club, pinned on top of the
 * timeline; with `past=1` the settled ones too, for its Challenges filter. See ADR 0045.
 */
export const GET = timelineChallengesHandler(registry);
