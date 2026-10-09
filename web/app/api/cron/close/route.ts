import { gateCron, json } from "@/lib/server/gate";
import { epochAt } from "@/lib/rewards";
import { settleDue } from "@/lib/server/challenges";
import { closeEpoch } from "@/lib/server/rewards";
import { registry } from "@/lib/verifiedAssets";

/**
 * The epoch close (ADR 0040).
 *
 *   GET /api/cron/close   Authorization: Bearer <CRON_SECRET>
 *
 * Just after an epoch ends, freezes each Club's inputs for it: holdings and their average, and the
 * backing and active days that still stand. Likes taken back, posts deleted and moderators' hides
 * after that don't change the epoch's points; the builder scores from the frozen inputs. Safe to
 * call again: a Club already closed is left alone. Vercel Cron calls it daily (vercel.json) with the
 * right header when CRON_SECRET is set. Challenges that have ended are settled first, so their points
 * are in the epoch they ended in before it's frozen (ADR 0045). Off (503) without a store or a CRON_SECRET.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const store = gateCron(request, "The epoch close");
  if (store instanceof Response) return store;
  const n = epochAt(Math.floor(Date.now() / 1000)) - 1;
  if (n < 0) return json({ status: "open", message: "No epoch has ended yet." });
  for (const club of registry.clubs()) {
    try {
      await settleDue(store, club);
    } catch (error) {
      console.error(`settling ${club.symbol} challenges failed:`, error);
    }
  }
  return json({ epoch: n, ...(await closeEpoch(store, n)) });
}
