import { bansHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * Bans (staff). GET lists them; POST `{ wallet | post, everywhere? }` bans a member or a post's
 * author; DELETE `{ wallet, everywhere? }` lifts one. `everywhere` is for app admins.
 */
const handlers = bansHandlers(registry);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
