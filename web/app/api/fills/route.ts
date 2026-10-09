import { isAddress } from "viem";
import { fillsKey, ingestFills, isFillContract, listFills } from "@/lib/server/fills";
import { fail, gateReport, json } from "@/lib/server/gate";
import { clientId, getStore, withinLimit } from "@/lib/server/store";

/**
 * Fill history (ADR 0012).
 *
 *   GET  /api/fills?account=0x…&contract=0x…   { enabled, ids }: trade ids that wallet filled
 *   POST /api/fills { hash }                   check that transaction's receipt, record its fills
 *
 * Both are public: the data is on-chain anyway, and a POST only ever records what the receipt shows.
 * With no store configured, `enabled` is false and the app keeps its per-browser record instead.
 */
export async function GET(request: Request) {
  const store = getStore();
  if (!store) return json({ enabled: false });

  const params = new URL(request.url).searchParams;
  const account = params.get("account") ?? "";
  const contract = params.get("contract") ?? "";
  if (!isAddress(account, { strict: false }) || !isAddress(contract, { strict: false }) || !isFillContract(contract)) {
    return fail(400, "bad_request", "Give a wallet and one of the swap contracts.");
  }
  if (!(await withinLimit(store, "fills-read", clientId(request), 240, 60))) {
    return fail(429, "rate_limited", "Too many requests.");
  }
  try {
    return json({ enabled: true, ids: await listFills(store, contract, account) });
  } catch (error) {
    // The browser falls back to its own record rather than showing an empty history.
    console.error(`fill lookup failed (${fillsKey(contract, account)}):`, error);
    return json({ enabled: false });
  }
}

export async function POST(request: Request) {
  const report = await gateReport(request, "fills-write");
  if (report instanceof Response) return report;
  const { store, hash } = report;
  try {
    const result = await ingestFills(store, hash);
    if (result.status === "pending") return json({ enabled: true, pending: true }, 404);
    return json({ enabled: true, recorded: result.fills });
  } catch (error) {
    console.error(`recording fills from ${hash} failed:`, error);
    return fail(502, "unavailable", "Couldn't record this fill yet.");
  }
}
