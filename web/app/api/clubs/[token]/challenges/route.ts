import { challengesHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * The Club's challenges (ADR 0045). GET: every challenge with its entries, settling the ones that
 * ended. POST (the Owner or an app admin): start one.
 */
const handlers = challengesHandlers(registry);
export const GET = handlers.GET;
export const POST = handlers.POST;
