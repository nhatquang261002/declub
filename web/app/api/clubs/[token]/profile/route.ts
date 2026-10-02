import { profileHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** GET (public) / PATCH (Owner or admin) /api/clubs/[token]/profile: description, links, "holders only can post". */
const handlers = profileHandlers(registry);
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
