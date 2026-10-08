import { createPublicClient, erc20Abi, http, type PublicClient } from "viem";
import { chain } from "../chain";
import { DECLUB_ESCROW_ADDRESS, RPC_URL } from "../config";
import { swapV2Abi } from "../contracts";
import { displayStatus } from "../deals";
import { cardItems, describeAssets, type DealFacts } from "../dealShare";
import { isOpenOffer, toDealV2, type RawDealV2 } from "../dealsV2";
import { erc20Tokens, type TokenInfo } from "../assets";
import { registry } from "../verifiedAssets";

let client: PublicClient | undefined;

/**
 * What a deal's preview card and share text need, read from the chain on the server. `null` for an
 * id that doesn't exist, an unreadable one or a deploy without the escrow: the page then has no
 * special preview and the site's default shows.
 */
export async function readDealFacts(id: string, nowSec = Math.floor(Date.now() / 1000)): Promise<DealFacts | null> {
  if (!DECLUB_ESCROW_ADDRESS || !/^\d{1,18}$/.test(id)) return null;
  try {
    client ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;
    const raw = (await client.readContract({ address: DECLUB_ESCROW_ADDRESS, abi: swapV2Abi, functionName: "getTrade", args: [BigInt(id)] })) as RawDealV2;
    const deal = toDealV2(BigInt(id), raw);
    if (!deal) return null;

    const tokens = erc20Tokens([...deal.offered, ...deal.requested]);
    const reads = await Promise.all(
      tokens.map(async (address) => {
        const [symbol, decimals] = await Promise.all([
          client!.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          client!.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
        ]).catch(() => [null, null] as const);
        return symbol === null
          ? []
          : [[address.toLowerCase(), { symbol: String(symbol).slice(0, 12), decimals: Number(decimals) } satisfies TokenInfo] as const];
      }),
    );
    const info = new Map(reads.flat());
    const nameOf = (token: string) => registry.entry(token)?.name;
    const club = [...deal.offered, ...deal.requested].map((a) => registry.clubFor(a.token)).find((c) => c !== null);
    return {
      id,
      status: displayStatus(deal, nowSec),
      give: describeAssets(deal.offered, info, nameOf),
      want: describeAssets(deal.requested, info, nameOf),
      openOffer: isOpenOffer(deal),
      club: club?.name,
      clubImage: club?.image,
      giveItems: cardItems(deal.offered, info, (t) => registry.entry(t)),
      wantItems: isOpenOffer(deal) ? [] : cardItems(deal.requested, info, (t) => registry.entry(t)),
    };
  } catch {
    return null;
  }
}
