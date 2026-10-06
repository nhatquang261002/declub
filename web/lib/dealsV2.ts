import { zeroAddress, type Address } from "viem";
import { toAsset, type Asset, type RawAsset } from "./assets";
import type { DealStatus } from "./deals";

/** A DeClubEscrow deal: what each side gives, as two lists of assets. */
export type DealV2 = {
  id: bigint;
  maker: Address;
  /** Only this wallet may fill. null = public offer. */
  taker: Address | null;
  /** Unix seconds. 0n = never expires. */
  expiry: bigint;
  status: DealStatus;
  /**
   * What each side of this deal pays in MON: the fee in force when it was listed (ADR 0018). The
   * taker or proposer sends this, not the contract's current `fee()`.
   */
  fee: bigint;
  offered: readonly Asset[];
  requested: readonly Asset[];
};

/** The shape `getTrade` returns (IDeClubEscrow.Deal). */
export type RawDealV2 = {
  maker: Address;
  expiry: bigint;
  status: number;
  taker: Address;
  fee: bigint;
  offered: readonly RawAsset[];
  requested: readonly RawAsset[];
};

/**
 * An open offer ("make me an offer") has no ask: takers answer with proposals instead
 * (ADR 0007). `fillTrade` can't settle one.
 */
export const isOpenOffer = (deal: Pick<DealV2, "requested">) => deal.requested.length === 0;

/** Bytes, as the contract counts them: an emoji or accented letter is more than one. */
export const noteBytes = (note: string) => new TextEncoder().encode(note).length;

const STATUS: Record<number, DealStatus> = { 1: "open", 2: "filled", 3: "cancelled" };

/** null for unknown ids (status None) or an asset type this build doesn't know. */
export function toDealV2(id: bigint, raw: RawDealV2): DealV2 | null {
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
    fee: raw.fee,
    offered: offered as Asset[],
    requested: requested as Asset[],
  };
}
