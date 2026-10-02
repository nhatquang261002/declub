import { postsHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * The Club's board (ADR 0016).
 *
 *   GET   { enabled, posts, role }  public; pinned first, then newest. A hidden post shows only a
 *         placeholder, except to its author and to staff (who send their access token).
 *   POST  { kind: "note" | "looking", text, link? }  members with a shared verified profile.
 */
const handlers = postsHandlers(registry);
export const GET = handlers.GET;
export const POST = handlers.POST;
