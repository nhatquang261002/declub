import { xLinkHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** POST / DELETE /api/clubs/[token]/x: the Owner links the project's X account by a proof post (ADR 0024). */
const handlers = xLinkHandlers(registry);
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
