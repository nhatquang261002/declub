import { claimableHandler } from "@/lib/server/rewardRoutes";

/**
 * GET /api/rewards/me?account=0x…   { enabled, contract, epoch, endsAt, leaves }: the account's
 * rewards, newest epoch first, with proofs to claim them. Whether each was claimed is read on chain.
 */
export const GET = claimableHandler();
