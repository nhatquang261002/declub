import { packImageHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/** GET: one emoji or sticker's picture (ADR 0057). Public. */
export const GET = packImageHandler(registry);
