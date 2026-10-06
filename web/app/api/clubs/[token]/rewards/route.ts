import { clubRewardsHandler } from "@/lib/server/rewardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/clubs/[token]/rewards   { enabled, contract, epoch, endsAt, epochs, carry, earners }: the
 * Club's fees and pools in the latest epochs, what rolls into the next, and who earned. 404 for an
 * address that has no Club.
 */
export const GET = clubRewardsHandler(registry);
