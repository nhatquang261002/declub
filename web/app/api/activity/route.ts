import { recordActivity, viemReader } from "@/lib/server/activity";
import { recordFills } from "@/lib/server/fills";
import { fail, gateReport, json } from "@/lib/server/gate";

/**
 * Reports a confirmed transaction (ADR 0012 for fills, ADR 0016 for Club activity).
 *
 *   POST /api/activity { hash }   check that transaction's receipt, record its fills and Club events
 *
 * Public: a POST only ever records what the receipt shows, and a repeat records nothing new. With no
 * store configured, `enabled` is false and the app keeps its per-browser record of fills instead.
 */
export async function POST(request: Request) {
  const report = await gateReport(request, "activity-write");
  if (report instanceof Response) return report;
  const { store, hash } = report;
  try {
    const reader = viemReader();
    const receipt = await reader.receipt(hash);
    if (!receipt) return json({ enabled: true, pending: true }, 404);
    const fills = await recordFills(store, receipt);
    const events = await recordActivity(store, hash, receipt, { reader });
    return json({ enabled: true, recorded: { fills, events } });
  } catch (error) {
    console.error(`recording activity from ${hash} failed:`, error);
    return fail(502, "unavailable", "Couldn't record this transaction yet.");
  }
}
