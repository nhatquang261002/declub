import { fail, json } from "@/lib/server/gate";
import { cronAuthorized, startBlockFromEnv, watchFills } from "@/lib/server/fillWatcher";
import { getStore } from "@/lib/server/store";

/**
 * The fill watcher (ADR 0019).
 *
 *   GET /api/cron/fills   Authorization: Bearer <CRON_SECRET>
 *
 * Scans the blocks since the last run for fills and new deals, and records them as a report to
 * /api/activity would. Run it every minute or so: Vercel Cron calls it with the right header when
 * CRON_SECRET is set, and any other scheduler can send the same header. Off (503) without a store
 * or a CRON_SECRET.
 */
// The scan stops starting new work at 40 s; this leaves room to finish the last chunk.
export const maxDuration = 60;

export async function GET(request: Request) {
  const store = getStore();
  const secret = process.env.CRON_SECRET?.trim();
  if (!store || !secret) return fail(503, "disabled", "The fill watcher is not configured.");
  if (!cronAuthorized(request, secret)) return fail(401, "unauthorized", "Missing or wrong cron secret.");

  try {
    return json(await watchFills(store, { startBlock: startBlockFromEnv() }));
  } catch (error) {
    // The cursor stays at the last block fully recorded, so the next run picks up from there.
    console.error("fill watcher run failed:", error);
    return fail(502, "unavailable", "The scan stopped early. The next run picks up where it left off.");
  }
}
