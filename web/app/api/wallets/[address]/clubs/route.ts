import { walletClubsHandler } from "@/lib/server/profilePageRoutes";

/** GET /api/wallets/[address]/clubs: the Clubs whose Members list shows this wallet (ADR 0042). */
export const GET = walletClubsHandler();
