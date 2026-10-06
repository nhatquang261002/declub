import { postsHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * The Club's board (ADR 0016, ADR 0023).
 *
 *   GET   ?lens=newest|momentum|holders|following&as=0x…   { enabled, posts, role }  public; pinned
 *         first (except under `following`), then in the lens's order. A hidden post shows only a
 *         placeholder, except to its author and to staff (who send their access token). `as` is
 *         the reader's wallet, for the `following` lens.
 *   POST  { message, signature }  members with a shared verified profile. `message` is the EIP-712
 *         `Post` (lib/social.ts) signed by the member's Club wallet.
 */
const handlers = postsHandlers(registry);
export const GET = handlers.GET;
export const POST = handlers.POST;
