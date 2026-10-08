import { decodeEventLog, formatEther, getAbiItem, toEventSelector, type Address, type Hex } from "viem";
import { deClubEscrowAbi, deClubIntentsAbi } from "../abi";
import type { EpochRecord } from "../rewards";
import type { LogField } from "@envio-dev/hypersync-client";
import { collectLogs, type HypersyncLike } from "./hypersyncScan";

/**
 * Checks an epoch's fees against the chain (ADR 0052). The builder takes each Club's fees from the
 * server's activity log and from settlement receipts, and the fees are the money the epoch pays
 * out. The contracts emit a `FeeCharged` for every one, so the epoch can't have counted more than
 * the chain charged in its window. Reading a week of logs takes HyperSync (ADR 0051): the public
 * RPC answers `eth_getLogs` for 100 blocks at a time.
 *
 * It is a ceiling, not an equality. A swap that names no Club in the list pays a fee no Club gets,
 * a swap that names several splits it with rounding dust left over, and the window is padded for
 * the clock differences below.
 */

/**
 * Seconds added to each end of the epoch's window. A signed swap is stamped by the matcher, not by
 * its block, so a swap at the edge can sit on either side of it.
 */
export const FEE_WINDOW_SLACK = 900;

const ESCROW_FEE = getAbiItem({ abi: deClubEscrowAbi, name: "FeeCharged" });
const INTENTS_FEE = getAbiItem({ abi: deClubIntentsAbi, name: "FeeCharged" });

/** The first block in `low`..`high` stamped at or after `timestamp`, or `high + 1n` when none is. */
export async function firstBlockAt(timestamp: number, low: bigint, high: bigint, timestampOf: (block: bigint) => Promise<number>): Promise<bigint> {
  let lo = low;
  let hi = high + 1n;
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if ((await timestampOf(mid)) < timestamp) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}

export type FeesOnChain = {
  /** `FeeCharged` by `DeClubEscrow`, in MON (wei). */
  escrow: bigint;
  /** `FeeCharged` by `DeClubIntents`, in WMON (wei). */
  intents: bigint;
  charges: number;
};

/** The `amount` of every `FeeCharged` that `address` emitted in blocks `from`..`to`, and how many there were. */
async function chargedBy(hypersync: HypersyncLike, address: Address, item: typeof ESCROW_FEE | typeof INTENTS_FEE, from: bigint, to: bigint) {
  const fields: LogField[] = ["Address", "Data", "Topic0", "Topic1", "Topic2", "Topic3"];
  const logs = await collectLogs(hypersync, from, to, { address: [address], topics: [[toEventSelector(item)]] }, fields);
  let total = 0n;
  for (const log of logs) {
    const topics = log.topics.filter((topic): topic is string => !!topic) as [Hex, ...Hex[]];
    const event = decodeEventLog({ abi: [item], data: (log.data ?? "0x") as Hex, topics });
    total += (event.args as { amount: bigint }).amount;
  }
  return { total, count: logs.length };
}

/** Every fee the two contracts charged in blocks `from`..`to`. `intents` may be absent. */
export async function feesOnChain(hypersync: HypersyncLike, contracts: { escrow: Address; intents?: Address }, from: bigint, to: bigint): Promise<FeesOnChain> {
  const escrow = await chargedBy(hypersync, contracts.escrow, ESCROW_FEE, from, to);
  const intents = contracts.intents ? await chargedBy(hypersync, contracts.intents, INTENTS_FEE, from, to) : { total: 0n, count: 0 };
  return { escrow: escrow.total, intents: intents.total, charges: escrow.count + intents.count };
}

const mon = (wei: bigint) => `${formatEther(wei)} MON`;

/**
 * What the Clubs were credited with, against what was charged. `signedFees` of each Club is what
 * signed swaps paid (WMON); the rest of `fees` is `DeClubEscrow`'s (MON).
 */
export function checkFees(record: Pick<EpochRecord, "clubs">, onChain: FeesOnChain): { problems: string[]; notes: string[] } {
  let signed = 0n;
  let escrow = 0n;
  for (const club of record.clubs) {
    const fees = BigInt(club.fees);
    const signedFees = BigInt(club.signedFees ?? "0");
    signed += signedFees;
    escrow += fees - signedFees;
  }
  const problems: string[] = [];
  if (escrow > onChain.escrow)
    problems.push(`The Clubs are credited ${mon(escrow)} of deal fees, but DeClubEscrow charged only ${mon(onChain.escrow)} in the epoch's window.`);
  if (signed > onChain.intents)
    problems.push(`The Clubs are credited ${mon(signed)} of signed-swap fees, but DeClubIntents charged only ${mon(onChain.intents)} in the epoch's window.`);
  const notes = [
    `fees on chain: ${mon(onChain.escrow)} from deals + ${mon(onChain.intents)} from signed swaps in ${onChain.charges} charges; the Clubs are credited ${mon(escrow)} + ${mon(signed)}.`,
  ];
  return { problems, notes };
}
