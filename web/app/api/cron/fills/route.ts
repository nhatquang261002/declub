import { fail, gateCron, json } from "@/lib/server/gate";
import { startBlockFromEnv, watchFills } from "@/lib/server/fillWatcher";

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
  const store = gateCron(request, "The fill watcher");
  if (store instanceof Response) return store;

  try {
    return json(await watchFills(store, { startBlock: startBlockFromEnv() }));
  } catch (error) {
    // The cursor stays at the last block fully recorded, so the next run picks up from there.
    console.error("fill watcher run failed:", error);
    return fail(502, "unavailable", "The scan stopped early. The next run picks up where it left off.");
  }
}
