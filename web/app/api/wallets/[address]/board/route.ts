import { walletBoardHandler } from "@/lib/server/profilePageRoutes";

/** GET /api/wallets/[address]/board: the Board posts a wallet wrote, as cards for its profile (ADR 0042). */
export const GET = walletBoardHandler();
