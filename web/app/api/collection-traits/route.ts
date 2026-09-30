import { getAddress, isAddress } from "viem";
import { scanCollection } from "@/lib/server/collectionScan";

/**
 * GET /api/collection-traits?address=0x…
 * The traits of every token in a collection, or how far the scan is, or why it can't be done.
 * The first call starts the scan; the client polls until `state` is "ready" or "unsupported".
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ state: "unsupported", reason: "Enter a valid collection address." }, { status: 400 });
  return Response.json(scanCollection(getAddress(address)), { headers: { "Cache-Control": "no-store" } });
}
