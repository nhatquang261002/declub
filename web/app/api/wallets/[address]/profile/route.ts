import { walletProfileHandler } from "@/lib/server/profilePageRoutes";

/** GET /api/wallets/[address]/profile: the handle, avatar, name and bio a wallet's owner shows (ADR 0042). */
export const GET = walletProfileHandler();
