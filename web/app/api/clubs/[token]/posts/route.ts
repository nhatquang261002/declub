import { postsHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * The Club's board (ADR 0016, ADR 0023).
 *
 *   GET   ?lens=newest|momentum|holders|following&as=0x…&limit=20&offset=0   { enabled, posts, role, total }  public; pinned
 *         first (except under `following`), then in the lens's order. A hidden post shows only a
 *         placeholder, except to its author and to staff (who send their access token). `as` is
 *         the reader's wallet, for the `following` lens. `limit` (max 100) and `offset` page the
 *         ranked list; without `limit` the whole board comes back. `total` is the whole list's size.
 *   POST  { message, signature, image? }  members with a shared verified profile. `message` is the EIP-712
 *         `Post` (lib/social.ts) signed by the member's Club wallet. With a picture (ADR 0056), `image`
 *         is a PNG, JPEG or WebP `data:` URL of at most 1 MB, and `message` is an `ImagePost` whose
 *         `image` is the SHA-256 of its bytes.
 */
const handlers = postsHandlers(registry);
export const GET = handlers.GET;
export const POST = handlers.POST;
