import { membershipHandlers } from "@/lib/server/memberRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * The caller's own membership of a Club (ADR 0016). Every call needs their Privy access token.
 *
 *   GET     { enabled, member, wallet?, holder?, joinedAt?, club?, signed? }
 *   POST    join (422 `no_wallet` without a linked wallet, 409 `archived` / `full`)
 *   PUT     { message, signature }: keeps the member's signed consent for the backup (ADR 0053)
 *   DELETE  leave
 */
const handlers = membershipHandlers(registry);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
