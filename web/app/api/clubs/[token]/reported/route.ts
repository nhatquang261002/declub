import { reportedHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** GET /api/clubs/[token]/reported: the posts and replies members reported (staff). Reports never hide a post by themselves. */
export const GET = reportedHandler(registry);
