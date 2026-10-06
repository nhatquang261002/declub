import { repliesHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** GET / POST /api/clubs/[token]/posts/[id]/replies: a post's replies, and a member's signed reply (ADR 0032). */
export const { GET, POST } = repliesHandlers(registry);
