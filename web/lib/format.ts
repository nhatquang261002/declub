import { formatEther, parseEther } from "viem";

/** 2000000000000000000n → "2 MON". Trims to 4 decimals. */
export function formatMon(wei: bigint): string {
  const [whole, frac = ""] = formatEther(wei).split(".");
  const trimmed = frac.slice(0, 4).replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""} MON`;
}

export type FeeUnit = "MON" | "WMON";

/** The protocol fee as the person pays it: MON in escrow deals, WMON (wrapped MON) in signed ones. */
export function formatFee(amount: bigint, unit: FeeUnit = "MON"): string {
  return formatMon(amount).replace(/ MON$/, ` ${unit}`);
}

/** "1.5" → 1500000000000000000n. Empty → 0n. Invalid or negative → null. */
export function parseMon(input: string): bigint | null {
  const value = input.trim();
  if (value === "") return 0n;
  if (!/^\d*\.?\d*$/.test(value) || value === ".") return null;
  try {
    return parseEther(value);
  } catch {
    return null;
  }
}

export const shortAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** "just now", "5m ago", "3h ago", "2d ago". A time in the future reads as "just now". */
export function ago(unixSec: number, nowSec: number): string {
  const delta = nowSec - unixSec;
  return delta < 30 ? "just now" : `${duration(delta)} ago`;
}

/** "expires in 3h", "expired 2m ago", "no expiry". */
export function expiryLabel(expiry: bigint, nowSec: number): string {
  if (expiry === 0n) return "no expiry";
  const delta = Number(expiry) - nowSec;
  return delta >= 0 ? `expires in ${duration(delta)}` : `expired ${duration(-delta)} ago`;
}

export function formatDate(unixSec: bigint): string {
  return new Date(Number(unixSec) * 1000).toLocaleString();
}

/** "#1, #2, #3" */
export const formatIds = (ids: readonly bigint[]) => ids.map((id) => `#${id}`).join(", ");

/** "1, 2, #3 4" → [1n, 2n, 3n, 4n]. null if any piece isn't a positive integer. */
export function parseIds(input: string): bigint[] | null {
  const parts = input.split(/[\s,]+/).map((p) => p.replace(/^#/, "")).filter(Boolean);
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  return parts.map((p) => BigInt(p)).filter((id) => id > 0n);
}
