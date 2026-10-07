import { fail, json } from "@/lib/server/gate";
import { cronAuthorized } from "@/lib/server/fillWatcher";
import { epochAt } from "@/lib/rewards";
import { closeEpoch } from "@/lib/server/rewards";
import { getStore } from "@/lib/server/store";

/**
 * The epoch close (ADR 0040).
 *
 *   GET /api/cron/close   Authorization: Bearer <CRON_SECRET>
 *
 * Just after an epoch ends, freezes each Club's inputs for it: holdings and their average, and the
 * backing and active days that still stand. Likes taken back, posts deleted and moderators' hides
 * after that don't change the epoch's points; the builder scores from the frozen inputs. Safe to
 * call again: a Club already closed is left alone. Vercel Cron calls it daily (vercel.json) with the
 * right header when CRON_SECRET is set. Off (503) without a store or a CRON_SECRET.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const store = getStore();
  const secret = process.env.CRON_SECRET?.trim();
  if (!store || !secret) return fail(503, "disabled", "The epoch close is not configured.");
  if (!cronAuthorized(request, secret)) return fail(401, "unauthorized", "Missing or wrong cron secret.");
  const n = epochAt(Math.floor(Date.now() / 1000)) - 1;
  if (n < 0) return json({ status: "open", message: "No epoch has ended yet." });
  return json({ epoch: n, ...(await closeEpoch(store, n)) });
}
