import { deletePostHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** DELETE /api/clubs/[token]/posts/[id]: the author, or a Moderator, Owner or admin who outranks them. */
export const DELETE = deletePostHandler(registry);
