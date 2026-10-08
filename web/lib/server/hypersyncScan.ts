import type { Log, LogField, LogFilter, Query, QueryResponse } from "@envio-dev/hypersync-client";
import type { Address, Hex } from "viem";
import type { ChainScan } from "./fillWatcher";

/**
 * Finds the watched transactions with Envio HyperSync instead of `eth_getLogs` (ADR 0051). HyperSync
 * answers a block range of any size, so a run covers hundreds of thousands of blocks in a few
 * queries and a backfill from the deploy block takes one run. It only says which transactions to
 * look at: the watcher still reads each receipt from the node and records nothing else (ADR 0019).
 */

/** What the scan uses of the Envio client, so a test can stand in for it. */
export type HypersyncLike = {
  getHeight(): Promise<number>;
  get(query: Query): Promise<QueryResponse>;
};

/**
 * Blocks per `txs` call: about a day of Monad. A free Envio token allows 15 requests a minute, so a
 * wide range (a backfill is a few queries, not dozens) matters more than a short one. The watcher
 * records a whole range before it moves its cursor, so it can't be much wider.
 */
export const HYPERSYNC_RANGE = 200_000;

/**
 * Every log in blocks `from`..`to` (inclusive) that matches `selection`, with `fields` filled in,
 * following the query's `nextBlock` until the range is done.
 */
export async function collectLogs(hypersync: HypersyncLike, from: bigint, to: bigint, selection: LogFilter, fields: LogField[]): Promise<Log[]> {
  const logs: Log[] = [];
  const end = Number(to) + 1; // `toBlock` is exclusive
  let next = Number(from);
  while (next < end) {
    const page = await hypersync.get({ fromBlock: next, toBlock: end, logs: [selection], fieldSelection: { log: fields } });
    logs.push(...page.data.logs.filter((log) => !log.removed));
    // A page that moves nowhere would repeat forever. Stop, and let the run fail and be retried.
    if (page.nextBlock <= next) throw new Error(`HyperSync stopped at block ${next} while asked for ${from}..${to}.`);
    next = page.nextBlock;
  }
  return logs;
}

export function hypersyncScan(
  hypersync: HypersyncLike,
  finalizedHead: () => Promise<bigint>,
  contracts: readonly Address[],
  topic0: readonly Hex[],
): ChainScan {
  return {
    range: HYPERSYNC_RANGE,
    async head() {
      // Envio may trail the node, or run ahead of what is final. A range is only scanned once both have it.
      const [finalized, indexed] = await Promise.all([finalizedHead(), hypersync.getHeight()]);
      return finalized < BigInt(indexed) ? finalized : BigInt(indexed);
    },
    async txs(from, to) {
      const logs = await collectLogs(hypersync, from, to, { address: [...contracts], topics: [[...topic0]] }, ["TransactionHash", "BlockNumber", "LogIndex"]);
      const found = logs
        .filter((log) => log.transactionHash)
        .map((log) => ({ block: log.blockNumber ?? 0, index: log.logIndex ?? 0, hash: log.transactionHash as Hex }));
      found.sort((a, b) => a.block - b.block || a.index - b.index);
      return [...new Set(found.map((log) => log.hash))];
    },
  };
}

/**
 * `primary` while it answers, and `fallback` for the run when its head can't be read. HyperSync is an
 * accelerator, so an Envio outage slows the watcher down to the node's pace instead of stopping it.
 * A failure after the head was read still throws: the cursor hasn't moved and the next run retries.
 */
export function withFallback(primary: ChainScan, fallback: ChainScan): ChainScan {
  let active = primary;
  return {
    get range() {
      return active.range;
    },
    async head() {
      try {
        active = primary;
        return await primary.head();
      } catch (error) {
        console.warn(`HyperSync didn't answer, scanning the node's logs instead: ${error instanceof Error ? error.message : error}`);
        active = fallback;
        return fallback.head();
      }
    },
    txs: (from, to) => active.txs(from, to),
  };
}
