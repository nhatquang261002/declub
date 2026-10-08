import { gateCron, json } from "@/lib/server/gate";
import { sampleHoldings } from "@/lib/server/held";
import { viemHoldings } from "@/lib/server/members";
import { registry } from "@/lib/verifiedAssets";

/**
 * The holdings sampler (ADR 0040).
 *
 *   GET /api/cron/holdings   Authorization: Bearer <CRON_SECRET>
 *
 * Once per UTC day per Club, reads every member's NFTs and adds them to the running epoch's totals,
 * so the Holder pool counts what a member held across the week, not at the moment it closed. A Club
 * already sampled today is skipped, so it is safe to call again. Vercel Cron calls it daily
 * (vercel.json) with the right header when CRON_SECRET is set. Off (503) without a store or a
 * CRON_SECRET.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const store = gateCron(request, "The holdings sampler");
  if (store instanceof Response) return store;
  return json(await sampleHoldings(store, registry.clubs(), viemHoldings, Math.floor(Date.now() / 1000)));
}
