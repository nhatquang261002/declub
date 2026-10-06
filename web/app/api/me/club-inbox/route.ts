import { clubInboxHandler } from "@/lib/server/memberRoutes";

/** GET /api/me/club-inbox   { enabled, items }: what the signed-in caller should hear about their Clubs. */
export const GET = clubInboxHandler();
