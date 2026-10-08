import { getAddress, isAddress } from "viem";
import { existingScan, scanCollection, scanSlotFree } from "@/lib/server/collectionScan";
import { clientId, getStore, withinLimit } from "@/lib/server/store";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/collection-traits?address=0x…
 * The traits of every token in a collection, or how far the scan is, or why it can't be done.
 * The first call starts the scan; the client polls until `state` is "ready" or "unsupported".
 *
 * Anyone may call it, and a scan makes this server fetch URLs the collection chose, so two limits
 * apply per caller: polls (every 1.5 s per collection while scanning) and, much tighter, new scans.
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ state: "unsupported", reason: "Enter a valid collection address." }, { status: 400 });
  const collection = getAddress(address);

  const store = getStore();
  const id = clientId(request);
  if (store && !(await withinLimit(store, "traits-read", id, 240, 60))) {
    return Response.json({ state: "unsupported", reason: "Too many requests. Try again in a minute." }, { status: 429, headers: NO_STORE });
  }
  const existing = existingScan(collection);
  if (existing) return Response.json(existing, { headers: NO_STORE });
  // Waiting for a free slot isn't starting a scan, so it doesn't count against the tight limit.
  if (!scanSlotFree()) return Response.json({ state: "busy" }, { headers: NO_STORE });
  if (store && !(await withinLimit(store, "traits-scan", id, 10, 600))) {
    return Response.json(
      { state: "unsupported", reason: "Too many collections scanned from here. Try again in a few minutes." },
      { status: 429, headers: NO_STORE },
    );
  }
  return Response.json(scanCollection(collection), { headers: NO_STORE });
}
