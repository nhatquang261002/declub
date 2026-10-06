import { feedHandler } from "@/lib/server/boardRoutes";
import { registry } from "@/lib/verifiedAssets";

/**
 * GET /api/clubs/[token]/feed   { enabled, club, domain, types, posts }: every signed post on the
 * Club's Board as its EIP-712 message and signature (ADR 0023), newest first. Posts hidden by
 * moderation are left out until they're restored.
 */
export const GET = feedHandler(registry);
