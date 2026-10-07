import { challengeHandlers } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * One challenge (ADR 0045). POST { action }: a member enters or withdraws a post; the Owner picks
 * the winners of a challenge they judge, or cancels it.
 */
const handlers = challengeHandlers(registry);
export const POST = handlers.POST;
