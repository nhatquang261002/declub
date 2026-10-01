import type { Hash } from "viem";
import { CHOG_SWAP_ADDRESS, CHOG_SWAP_V2_ADDRESS } from "./config";

/** The writes that emit `TradeFilled` (an accepted proposal fills the deal for its proposer). */
const FILL_FUNCTIONS = new Set(["fillTrade", "fillTraitTrade", "acceptProposal"]);

/** True for a contract call whose receipt can hold a fill that History should know about. */
export function mayFill(call: { address: string; functionName: unknown }): boolean {
  const target = call.address.toLowerCase();
  const ours = target === CHOG_SWAP_ADDRESS.toLowerCase() || target === CHOG_SWAP_V2_ADDRESS?.toLowerCase();
  return ours && FILL_FUNCTIONS.has(String(call.functionName));
}

const RETRY_AFTER_MS = [0, 1_000, 2_000, 4_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tells the server about a confirmed fill so every device's History has it (ADR 0012). The server
 * reads the receipt itself, so this carries nothing but the hash. A node can lag a moment behind
 * the one that confirmed the transaction, so "not found yet" is retried. Never throws: History
 * is a convenience, and the fill has already happened.
 */
export async function reportFill(hash: Hash): Promise<void> {
  for (const wait of RETRY_AFTER_MS) {
    if (wait) await sleep(wait);
    try {
      const response = await fetch("/api/fills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash }),
      });
      if (response.status !== 404) return;
    } catch {
      return;
    }
  }
}
