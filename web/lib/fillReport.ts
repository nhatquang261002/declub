import type { Hash } from "viem";
import { DECLUB_ESCROW_ADDRESS } from "./config";

/** The writes that emit `TradeFilled` (an accepted proposal fills the deal for its proposer). */
const FILL_FUNCTIONS = new Set(["fillTrade", "fillTraitTrade", "acceptProposal"]);
/** The DeClubEscrow writes that start a deal. They add to a Club's activity, not to anyone's History. */
const CREATE_FUNCTIONS = new Set(["createTrade", "createTraitTrade", "createOpenOffer"]);

/** True for a contract call whose receipt can hold a fill that History should know about. */
export function mayFill(call: { address: string; functionName: unknown }): boolean {
  return call.address.toLowerCase() === DECLUB_ESCROW_ADDRESS?.toLowerCase() && FILL_FUNCTIONS.has(String(call.functionName));
}

/**
 * True for a contract call whose receipt the server should read: a fill (see `mayFill`), or a
 * DeClubEscrow call that starts a deal and so feeds a Club's activity (ADR 0016).
 */
export function mayReport(call: { address: string; functionName: unknown }): boolean {
  const target = call.address.toLowerCase();
  const name = String(call.functionName);
  return target === DECLUB_ESCROW_ADDRESS?.toLowerCase() && (FILL_FUNCTIONS.has(name) || CREATE_FUNCTIONS.has(name));
}

const RETRY_AFTER_MS = [0, 1_000, 2_000, 4_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tells the server about a confirmed transaction so every device's History has its fill (ADR 0012)
 * and the Clubs of the assets it touched have the activity (ADR 0016). The server reads the receipt
 * itself, so this carries nothing but the hash. A node can lag a moment behind
 * the one that confirmed the transaction, so "not found yet" is retried. Never throws: History
 * is a convenience, and the fill has already happened.
 */
export async function reportTx(hash: Hash): Promise<void> {
  for (const wait of RETRY_AFTER_MS) {
    if (wait) await sleep(wait);
    try {
      const response = await fetch("/api/activity", {
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
