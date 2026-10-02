import { myClubsHandler } from "@/lib/server/memberRoutes";
import { registry } from "@/lib/verifiedAssets";

/** GET /api/me/clubs   { enabled, clubs: token[] }: the Clubs the signed-in caller belongs to. */
export const GET = myClubsHandler(registry);
