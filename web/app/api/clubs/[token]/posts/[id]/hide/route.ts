import { hideHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** POST /api/clubs/[token]/posts/[id]/hide  { hidden }: hide or restore a post (staff). */
export const POST = hideHandler(registry);
