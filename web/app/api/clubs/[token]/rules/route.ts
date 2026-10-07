import { rulesHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * The Club's reward rules (ADR 0044). GET: the rules now, any change waiting for the next epoch, and
 * the bounds. PATCH (the Owner or an app admin): change some of them, from the next epoch.
 */
const handlers = rulesHandlers(registry);
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
