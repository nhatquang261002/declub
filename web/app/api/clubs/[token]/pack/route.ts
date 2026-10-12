import { packHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * A Club's own emoji and stickers (ADR 0057).
 *
 *   GET     { enabled, pack: [{ name, kind, url }], builtin, limits }   public, cached briefly. `builtin` are the stickers
 *           every Club has; a name in `pack` replaces the built-in one.
 *   PUT     { name, kind: "emoji" | "sticker", image }          staff: add one, or replace the one of that name.
 *                                                               `image` is a PNG, JPEG or WebP `data:` URL under 256 KB.
 *   DELETE  { name }                                            staff: remove one
 */
const handlers = packHandlers(registry);
export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
