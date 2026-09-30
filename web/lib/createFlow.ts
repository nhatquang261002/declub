import { isAddress, zeroAddress, type Address } from "viem";

/**
 * The three ways to start a deal. "open" (makers list assets, takers send offers) and, when
 * ChogSwapV2 is configured, "exact" and "trait" settle on V2 (ADR 0005–0007). Without V2, "exact"
 * and "trait" fall back to the Chog contract.
 */
export type DealKind = "open" | "exact" | "trait";
export type Step = 1 | 2 | 3;
export const STEP_LABELS = ["Deal type", "Your assets", "Confirm"] as const;

export type Expiry = "1h" | "24h" | "7d" | "none";
export const EXPIRIES: ReadonlyArray<{ key: Expiry; label: string; seconds: number }> = [
  { key: "1h", label: "1 hour", seconds: 3600 },
  { key: "24h", label: "24 hours", seconds: 86400 },
  { key: "7d", label: "7 days", seconds: 604800 },
  { key: "none", label: "Never", seconds: 0 },
];

/** The settings both contracts share, kept above the flows so they survive switching between them. */
export type Terms = { taker: string; expiry: Expiry };
export const DEFAULT_TERMS: Terms = { taker: "", expiry: "24h" };

export const expiryLabelOf = (expiry: Expiry) => EXPIRIES.find((e) => e.key === expiry)!.label;

/** Unix seconds for the contract; 0 means the deal never expires. */
export function expiryTimestamp(expiry: Expiry): bigint {
  const { seconds } = EXPIRIES.find((e) => e.key === expiry)!;
  return seconds === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + seconds);
}

/** What is wrong with the "only this wallet" field, or null when it is empty or fine. */
export function takerError(text: string, me: Address | undefined): string | null {
  const taker = text.trim();
  if (!taker) return null;
  if (!isAddress(taker)) return "Enter a valid wallet address, or leave it empty.";
  if (me && taker.toLowerCase() === me.toLowerCase()) return "You cannot make a private offer to yourself.";
  return null;
}

/** The contracts take the zero address to mean "anyone". */
export const takerAddress = (text: string): Address => (text.trim() || zeroAddress) as Address;
