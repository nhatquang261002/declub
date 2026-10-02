import { isHash } from "viem";
import { recordActivity, viemReader } from "@/lib/server/activity";
import { recordFills } from "@/lib/server/fills";
import { clientId, getStore, withinLimit } from "@/lib/server/store";

/**
 * Reports a confirmed transaction (ADR 0012 for fills, ADR 0016 for Club activity).
 *
 *   POST /api/activity { hash }   check that transaction's receipt, record its fills and Club events
 *
 * Public: a POST only ever records what the receipt shows, and a repeat records nothing new. With no
 * store configured, `enabled` is false and the app keeps its per-browser record of fills instead.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function POST(request: Request) {
  const store = getStore();
  if (!store) return json({ enabled: false });

  const body = (await request.json().catch(() => ({}))) as { hash?: unknown };
  if (typeof body.hash !== "string" || !isHash(body.hash)) {
    return json({ error: "bad_request", message: "Give a transaction hash." }, 400);
  }
  // Each report costs RPC calls, so it is limited more tightly than reads.
  if (!(await withinLimit(store, "activity-write", clientId(request), 60, 60))) {
    return json({ error: "rate_limited", message: "Too many requests." }, 429);
  }
  try {
    const reader = viemReader();
    const receipt = await reader.receipt(body.hash);
    if (!receipt) return json({ enabled: true, pending: true }, 404);
    const fills = await recordFills(store, receipt);
    const events = await recordActivity(store, body.hash, receipt, { reader });
    return json({ enabled: true, recorded: { fills, events } });
  } catch (error) {
    console.error(`recording activity from ${body.hash} failed:`, error);
    return json({ error: "unavailable", message: "Couldn't record this transaction yet." }, 502);
  }
}
