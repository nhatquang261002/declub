import { zeroAddress, type Address } from "viem";
import { toAsset, type Asset, type RawAsset } from "./assets";
import { CHOG_ADDRESS } from "./config";
import type { Deal, DealStatus } from "./deals";

/** A OnDealV2 deal: two lists of assets instead of v1's Chog ids + one MON amount. */
export type DealV2 = {
  id: bigint;
  maker: Address;
  /** Only this wallet may fill. null = public offer. */
  taker: Address | null;
  /** Unix seconds. 0n = never expires. */
  expiry: bigint;
  status: DealStatus;
  offered: readonly Asset[];
  requested: readonly Asset[];
};

/** The shape `getTrade` returns (IOnDealV2.Deal). */
export type RawDealV2 = {
  maker: Address;
  expiry: bigint;
  status: number;
  taker: Address;
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
    offered: offered as Asset[],
    requested: requested as Asset[],
  };
}

/**
 * Lets the existing deal UI (cards, filters, notifications) show a V2 deal unchanged, when it
 * only uses what that UI already understands: Chogs and MON. Deals with any other token return
 * null and need the generic asset UI instead.
 */
export function toLegacyDeal(deal: DealV2, chogAddress: Address = CHOG_ADDRESS): Deal | null {
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
  const offered = side(deal.offered);
  const requested = side(deal.requested);
  if (!offered || !requested) return null;
  return {
    id: deal.id,
    maker: deal.maker,
    taker: deal.taker,
    expiry: deal.expiry,
    status: deal.status,
    offeredIds: offered.ids,
    offeredMon: offered.mon,
    requestedIds: requested.ids,
    requestedMon: requested.mon,
  };
}
