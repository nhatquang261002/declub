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
  requestedRoot?: `0x${string}`;
  requestedCount?: bigint;
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
  requestedRoot?: `0x${string}`;
  requestedCount?: bigint;
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
    requestedRoot: raw.requestedRoot,
    requestedCount: raw.requestedCount,
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

/** Local-only showcase data for reviewing the trades UI without a wallet or testnet state. */
export function demoTrades(nowSec = Math.floor(Date.now() / 1000)): Trade[] {
  return [
    {
      id: 1006n,
      maker: "0x6666666666666666666666666666666666666666",
      taker: null,
      expiry: BigInt(nowSec + 172_800),
      status: "open",
      offeredIds: [1159n, 143n],
      offeredMon: 1_250_000_000_000_000_000n,
      requestedIds: [1376n, 909n],
      requestedMon: 0n,
    },
    {
      id: 1005n,
      maker: "0x7777777777777777777777777777777777777777",
      taker: null,
      expiry: BigInt(nowSec + 14_400),
      status: "open",
      offeredIds: [67n, 909n],
      offeredMon: 0n,
      requestedIds: [1159n],
      requestedMon: 750_000_000_000_000_000n,
    },
    {
      id: 1004n,
      maker: "0x1111111111111111111111111111111111111111",
      taker: null,
      expiry: BigInt(nowSec + 86_400),
      status: "open",
      offeredIds: [1159n],
      offeredMon: 0n,
      requestedIds: [1376n],
      requestedMon: 0n,
    },
    {
      id: 1003n,
      maker: "0x2222222222222222222222222222222222222222",
      taker: "0x3333333333333333333333333333333333333333",
      expiry: BigInt(nowSec + 7_200),
      status: "open",
      offeredIds: [143n, 67n],
      offeredMon: 0n,
      requestedIds: [],
      requestedMon: 1_500_000_000_000_000_000n,
    },
    {
      id: 1002n,
      maker: "0x4444444444444444444444444444444444444444",
      taker: null,
      expiry: 0n,
      status: "open",
      offeredIds: [],
      offeredMon: 2_000_000_000_000_000_000n,
      requestedIds: [909n],
      requestedMon: 0n,
    },
    {
      id: 1001n,
      maker: "0x5555555555555555555555555555555555555555",
      taker: null,
      expiry: BigInt(nowSec - 3_600),
      status: "open",
      offeredIds: [67n],
      offeredMon: 0n,
      requestedIds: [143n],
      requestedMon: 0n,
    },
    {
      id: 1000n,
      maker: "0x8888888888888888888888888888888888888888",
      taker: null,
      expiry: BigInt(nowSec + 259_200),
      status: "open",
      offeredIds: [909n],
      offeredMon: 0n,
      requestedIds: [67n, 143n],
      requestedMon: 0n,
    },
    {
      id: 999n,
      maker: "0x9999999999999999999999999999999999999999",
      taker: null,
      expiry: BigInt(nowSec + 43_200),
      status: "open",
      offeredIds: [],
      offeredMon: 500_000_000_000_000_000n,
      requestedIds: [1159n],
      requestedMon: 0n,
    },
    {
      id: 998n,
      maker: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      taker: null,
      expiry: BigInt(nowSec + 10_800),
      status: "open",
      offeredIds: [1376n],
      offeredMon: 0n,
      requestedIds: [909n],
      requestedMon: 1_000_000_000_000_000_000n,
    },
    {
      id: 997n,
      maker: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      taker: null,
      expiry: BigInt(nowSec - 1_800),
      status: "open",
      offeredIds: [143n],
      offeredMon: 0n,
      requestedIds: [67n],
      requestedMon: 0n,
    },
    {
      id: 996n,
      maker: "0xcccccccccccccccccccccccccccccccccccccccc",
      taker: null,
      expiry: 0n,
      status: "open",
      offeredIds: [1159n, 909n],
      offeredMon: 0n,
      requestedIds: [],
      requestedMon: 1_750_000_000_000_000_000n,
    },
    {
      id: 995n,
      maker: "0xdddddddddddddddddddddddddddddddddddddddd",
      taker: null,
      expiry: BigInt(nowSec + 172_800),
      status: "open",
      offeredIds: [67n],
      offeredMon: 2_500_000_000_000_000_000n,
      requestedIds: [1376n, 143n],
      requestedMon: 0n,
    },
  ];
}
