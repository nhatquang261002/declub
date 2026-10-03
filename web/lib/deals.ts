import { zeroAddress, type Address } from "viem";

export type DealStatus = "open" | "filled" | "cancelled";
/** What the UI shows. "expired" is derived from `expiry`, the contract still stores Open. */
export type DisplayStatus = DealStatus | "expired";

export type Deal = {
  id: bigint;
  maker: Address;
  /** Only this wallet may fill. null = public offer. */
  taker: Address | null;
  /** Unix seconds. 0n = never expires. */
  expiry: bigint;
  status: DealStatus;
  offeredIds: readonly bigint[];
  offeredMon: bigint;
  requestedIds: readonly bigint[];
  requestedMon: bigint;
  requestedRoot?: `0x${string}`;
  requestedCount?: bigint;
};

/** The shape `getTrade` returns (IOnDeal.Deal). */
export type RawDeal = {
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

// IOnDeal.Status: None = 0, Open = 1, Filled = 2, Cancelled = 3
const STATUS: Record<number, DealStatus> = { 1: "open", 2: "filled", 3: "cancelled" };

/** null for unknown ids (status None). */
export function toDeal(id: bigint, raw: RawDeal): Deal | null {
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

/** Mirrors OnDeal.isExpired: expired strictly after `expiry`. */
export function isExpired(deal: Pick<Deal, "expiry">, nowSec: number): boolean {
  return deal.expiry !== 0n && BigInt(nowSec) > deal.expiry;
}

export function displayStatus(deal: Pick<Deal, "status" | "expiry">, nowSec: number): DisplayStatus {
  if (deal.status === "open" && isExpired(deal, nowSec)) return "expired";
  return deal.status;
}

export const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
