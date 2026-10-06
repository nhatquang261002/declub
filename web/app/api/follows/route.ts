import { followHandler } from "@/lib/server/socialRoutes";

/**
 * POST /api/follows  { message, signature }: follow or unfollow a wallet with a signed EIP-712
 * `Follow` (ADR 0023). Needs sign-in; the follower must be one of the caller's linked wallets.
 */
export const POST = followHandler();
