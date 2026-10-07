import { aboutHandlers } from "@/lib/server/profilePageRoutes";

/** GET / PUT /api/about: the signed-in user's own display name and bio (ADR 0042). */
const handlers = aboutHandlers();
export const GET = handlers.GET;
export const PUT = handlers.PUT;
