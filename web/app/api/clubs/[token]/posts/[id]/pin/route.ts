import { pinHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** POST /api/clubs/[token]/posts/[id]/pin  { pinned }: pin or unpin a post (Owner or admin). */
export const POST = pinHandler(registry);
