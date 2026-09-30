import { zeroAddress, type Address } from "viem";
import { toAsset, type Asset, type RawAsset } from "./assets";
import { CHOG_ADDRESS } from "./config";
import type { Trade, TradeStatus } from "./trades";

/** A ChogSwapV2 trade: two lists of assets instead of v1's Chog ids + one MON amount. */
export type TradeV2 = {
  id: bigint;
  maker: Address;
  /** Only this wallet may fill. null = public offer. */
  taker: Address | null;
  /** Unix seconds. 0n = never expires. */
  expiry: bigint;
  status: TradeStatus;
  offered: readonly Asset[];
  requested: readonly Asset[];
};

/** The shape `getTrade` returns (IChogSwapV2.Trade). */
export type RawTradeV2 = {
  maker: Address;
  expiry: bigint;
  status: number;
  taker: Address;
  offered: readonly RawAsset[];
  requested: readonly RawAsset[];
};

const STATUS: Record<number, TradeStatus> = { 1: "open", 2: "filled", 3: "cancelled" };

/** null for unknown ids (status None) or an asset type this build doesn't know. */
export function toTradeV2(id: bigint, raw: RawTradeV2): TradeV2 | null {
  const status = STATUS[raw.status];
  if (!status) return null;
  const offered = raw.offered.map(toAsset);
  const requested = raw.requested.map(toAsset);
  if (offered.includes(null) || requested.includes(null)) return null;
  return {
    id,
    maker: raw.maker,
    taker: raw.taker === zeroAddress ? null : raw.taker,
    expiry: raw.expiry,
    status,
    offered: offered as Asset[],
    requested: requested as Asset[],
  };
}

/**
 * Lets the existing trade UI (cards, filters, notifications) show a V2 trade unchanged, when it
 * only uses what that UI already understands: Chogs and MON. Trades with any other token return
 * null and need the generic asset UI instead.
 */
export function toLegacyTrade(trade: TradeV2, chogAddress: Address = CHOG_ADDRESS): Trade | null {
  const side = (assets: readonly Asset[]) => {
    const ids: bigint[] = [];
    let mon = 0n;
    for (const a of assets) {
      if (a.kind === "erc721" && a.token.toLowerCase() === chogAddress.toLowerCase()) ids.push(a.id);
      else if (a.kind === "native") mon += a.amount;
      else return null;
    }
    return { ids, mon };
  };
  const offered = side(trade.offered);
  const requested = side(trade.requested);
  if (!offered || !requested) return null;
  return {
    id: trade.id,
    maker: trade.maker,
    taker: trade.taker,
    expiry: trade.expiry,
    status: trade.status,
    offeredIds: offered.ids,
    offeredMon: offered.mon,
    requestedIds: requested.ids,
    requestedMon: requested.mon,
  };
}
