import { getAddress, isAddress } from "viem";
import { MAX_QUERY } from "@/lib/search";
import { searchChain } from "@/lib/server/chainSearch";
import { clientId, getStore, withinLimit } from "@/lib/server/store";

/**
 * GET /api/search?q=&owner=0x…&kind=erc20|erc721|any&scope=holdings|all
 * Tokens and NFT collections by name, symbol or address, the wallet's holdings first (ADR 0027).
 * Anyone may call it and a provider call can cost credits, so it is limited per caller.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const owner = params.get("owner") ?? "";
  if (owner && !isAddress(owner)) return Response.json({ error: "owner must be an address" }, { status: 400 });
  const kind = params.get("kind");
  const scope = params.get("scope");

  const store = getStore();
  if (store && !(await withinLimit(store, "search", clientId(request), 90, 60))) {
    return Response.json({ error: "Too many searches. Try again in a minute." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const result = await searchChain({
    query: (params.get("q") ?? "").slice(0, MAX_QUERY),
    owner: owner ? getAddress(owner) : undefined,
    kind: kind === "erc20" || kind === "erc721" ? kind : "any",
    // Holdings of nobody is nothing, so a search with no wallet is always over everything.
    scope: scope === "holdings" && owner ? "holdings" : "all",
  });
  return Response.json(result, { headers: { "Cache-Control": "private, max-age=10" } });
}
