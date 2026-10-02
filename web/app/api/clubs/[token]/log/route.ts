import { logHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** GET /api/clubs/[token]/log: the moderation log (staff). */
export const GET = logHandler(registry);
