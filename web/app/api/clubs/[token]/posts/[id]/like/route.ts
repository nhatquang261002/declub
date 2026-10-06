import { likeHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** POST / DELETE /api/clubs/[token]/posts/[id]/like: a member likes a post, or takes the like back. */
export const { POST, DELETE } = likeHandlers(registry);
