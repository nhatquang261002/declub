import { zeroAddress, type Address } from "viem";

export type TradeStatus = "open" | "filled" | "cancelled";
/** What the UI shows. "expired" is derived from `expiry`, the contract still stores Open. */
export type DisplayStatus = TradeStatus | "expired";

export type Trade = {
  id: bigint;
  maker: Address;
  /** Only this wallet may fill. null = public offer. */
  taker: Address | null;
  /** Unix seconds. 0n = never expires. */
  expiry: bigint;
  status: TradeStatus;
  offeredIds: readonly bigint[];
  offeredMon: bigint;
  requestedIds: readonly bigint[];
  requestedMon: bigint;
};

/** The shape `getTrade` returns (IChogSwap.Trade). */
export type RawTrade = {
  maker: Address;
  expiry: bigint;
  status: number;
  taker: Address;
  offeredMon: bigint;
  requestedMon: bigint;
  offeredIds: readonly bigint[];
  requestedIds: readonly bigint[];
};

// IChogSwap.Status: None = 0, Open = 1, Filled = 2, Cancelled = 3
const STATUS: Record<number, TradeStatus> = { 1: "open", 2: "filled", 3: "cancelled" };

/** null for unknown ids (status None). */
export function toTrade(id: bigint, raw: RawTrade): Trade | null {
  const status = STATUS[raw.status];
  if (!status) return null;
  return {
    id,
    maker: raw.maker,
    taker: raw.taker === zeroAddress ? null : raw.taker,
    expiry: raw.expiry,
    status,
    offeredIds: raw.offeredIds,
    offeredMon: raw.offeredMon,
    requestedIds: raw.requestedIds,
    requestedMon: raw.requestedMon,
  };
}

/** Mirrors ChogSwap.isExpired: expired strictly after `expiry`. */
export function isExpired(trade: Trade, nowSec: number): boolean {
  return trade.expiry !== 0n && BigInt(nowSec) > trade.expiry;
}

export function displayStatus(trade: Trade, nowSec: number): DisplayStatus {
  if (trade.status === "open" && isExpired(trade, nowSec)) return "expired";
  return trade.status;
}

export const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
