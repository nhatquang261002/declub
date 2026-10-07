import { rewardBansHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * Bans from rewards (ADR 0044). GET lists them (staff); POST `{ wallet }` bans a member by their Club
 * wallet and DELETE `{ wallet }` lifts it (the Owner or an app admin). A banned member isn't paid and
 * their backing gives nobody points, in every epoch not yet closed.
 */
const handlers = rewardBansHandlers(registry);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
