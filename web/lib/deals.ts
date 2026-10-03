export type DealStatus = "open" | "filled" | "cancelled";
/** What the UI shows. "expired" is derived from `expiry`, the contract still stores Open. */
export type DisplayStatus = DealStatus | "expired";

/** Mirrors OnDealV2.isExpired: expired strictly after `expiry`. */
export function isExpired(deal: { expiry: bigint }, nowSec: number): boolean {
  return deal.expiry !== 0n && BigInt(nowSec) > deal.expiry;
}

export function displayStatus(deal: { status: DealStatus; expiry: bigint }, nowSec: number): DisplayStatus {
  if (deal.status === "open" && isExpired(deal, nowSec)) return "expired";
  return deal.status;
}

export const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
