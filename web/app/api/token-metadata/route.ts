import { createPublicClient, getAddress, http, isAddress, parseAbi, type PublicClient } from "viem";
import { chain } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { readJson } from "@/lib/server/collectionScan";
import { clientId, getStore, withinLimit } from "@/lib/server/store";

const abi = parseAbi(["function tokenURI(uint256) view returns (string)"]);
let cached: PublicClient | undefined;
const rpc = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

const MAX_URL = 2048;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/**
 * GET /api/token-metadata?collection=0x…&id=1
 * A token's name, image and traits, read here because many hosts (scatter.art) send no CORS header,
 * so the visitor's browser can't read their JSON. The URI comes from the chain, never from the
 * caller, and `readJson` only fetches public https hosts (see `safeUrl`).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const collection = params.get("collection") ?? "";
  const id = params.get("id") ?? "";
  if (!isAddress(collection) || !/^\d{1,78}$/.test(id)) return Response.json({ error: "Bad request." }, { status: 400 });

  const store = getStore();
  if (store && !(await withinLimit(store, "token-metadata", clientId(request), 600, 60))) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const uri = await rpc().readContract({ address: getAddress(collection), abi, functionName: "tokenURI", args: [BigInt(id)] });
    const json = (await readJson(uri)) as { name?: unknown; image?: unknown; image_url?: unknown; attributes?: unknown } | null;
    if (!json || typeof json !== "object") return Response.json({ error: "No metadata." }, { status: 404 });
    const attributes = Array.isArray(json.attributes)
      ? json.attributes.slice(0, 40).flatMap((a: { trait_type?: unknown; value?: unknown }) => {
          const type = text(a?.trait_type, 48);
          const value = typeof a?.value === "number" ? String(a.value) : text(a?.value, 48);
          return type && value !== null ? [{ trait_type: type, value }] : [];
        })
      : [];
    return Response.json(
      { name: text(json.name, 96), image: text(json.image, MAX_URL) || text(json.image_url, MAX_URL), attributes },
      // Token metadata rarely changes; a short shared cache spares the host on every card render.
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch {
    return Response.json({ error: "Could not read the token." }, { status: 502 });
  }
}
