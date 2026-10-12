import { postImageHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * A post's picture (ADR 0056).
 *
 *   GET   the picture's bytes. Public unless the post is hidden; then only its author and staff
 *         (who send their access token) get it, and everyone else gets a 404.
 */
export const GET = postImageHandler(registry);
