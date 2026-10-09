import { reportHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** POST /api/clubs/[token]/posts/[id]/report: a member's report; three reports from Holders or staff hide the post. */
export const POST = reportHandler(registry);
