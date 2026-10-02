import { lookupHandler } from "@/lib/server/handleLookup";

/** GET /api/profiles/lookup?handle=@bob: the wallets a trader shares under a handle (ADR 0017). */
export const GET = lookupHandler();
