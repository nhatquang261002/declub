import { walletFollowsHandler } from "@/lib/server/socialRoutes";

/** GET /api/wallets/[address]/follows: the wallet's signed follows and its follower count (ADR 0023). */
export const GET = walletFollowsHandler();
