import { sponsorHandler, sponsorInfoHandler } from "@/lib/server/sponsorRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET  /api/clubs/[token]/sponsor   { enabled, to, min, epoch, endsAt }: where a sponsor sends MON.
 * POST /api/clubs/[token]/sponsor   { tx, name, signature }: records a payment to the operator as a
 * sponsorship of the Club's Holder pool (ADR 0036). The server checks the payment on chain.
 */
export const GET = sponsorInfoHandler(registry);
export const POST = sponsorHandler(registry);
