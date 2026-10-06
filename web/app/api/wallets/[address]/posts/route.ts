import { walletPostsHandler } from "@/lib/server/socialRoutes";

/** GET /api/wallets/[address]/posts: every signed Board post the wallet wrote, across Clubs (ADR 0023). */
export const GET = walletPostsHandler();
