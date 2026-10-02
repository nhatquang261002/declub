import { claimHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** POST /api/clubs/[token]/claim: a member whose linked wallet is the token's `owner()` becomes Owner. */
export const POST = claimHandler(registry);
