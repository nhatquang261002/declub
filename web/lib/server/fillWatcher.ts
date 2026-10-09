import { timingSafeEqual } from "node:crypto";
import { createPublicClient, getAbiItem, http, toEventSelector, type Address, type Hex, type PublicClient } from "viem";
import { deClubEscrowAbi } from "../abi";
import { chain } from "../chain";
import { CHAIN_ID, RPC_URL } from "../config";
import { ACTIVITY_CONTRACTS, recordActivity, viemReader, type IngestOptions, type Reader } from "./activity";
import { FILL_CONTRACTS, recordFills } from "./fills";
import { hypersyncScan, withFallback } from "./hypersyncScan";
import type { Store } from "./store";

/**
 * The fill watcher (ADR 0019). The app reports the transactions it sends (ADR 0012, ADR 0016), so a
 * deal filled straight through the contract, from another app, or in a tab closed too soon was
 * missing from History and from Momentum. This follows the chain from a cursor instead: each run
 * scans the blocks since the last one for `TradeFilled` and `TradeCreated`, and passes every
 * transaction that emitted one through the same receipt checks a report goes through. Those only
 * ever record what the chain says, and recording a transaction twice changes nothing, so a rescan,
 * an overlap with a report, or a run cut short is harmless.
 *
 * A cron calls it (`GET /api/cron/fills`). A run stops starting new work once its time budget is
 * spent and leaves the cursor at the last block it finished, so a long backlog is worked off over
 * several runs.
 */

/**
 * The chain reads a scan makes, apart from the receipts (`Reader`). Real in production
 * (`viemScan`), a fake in tests.
 */
export type ChainScan = {
  /** The newest finalized block: nothing at or below it can be reorganised away. */
  head(): Promise<bigint>;
  /** Transactions in blocks `from`..`to` (inclusive) that emitted a watched event, in chain order, each once. */
  txs(from: bigint, to: bigint): Promise<Hex[]>;
  /** Blocks per `txs` call this source answers. Without one, the public RPC's 100. */
  range?: number;
};

/** Every contract whose events count: fills, and creations for the Clubs. */
const WATCHED: Address[] = [...new Set([...FILL_CONTRACTS, ...ACTIVITY_CONTRACTS])];

const EVENTS = [getAbiItem({ abi: deClubEscrowAbi, name: "TradeFilled" }), getAbiItem({ abi: deClubEscrowAbi, name: "TradeCreated" })];

/** The public RPC answers `eth_getLogs` for at most 100 blocks (ADR 0004). */
const DEFAULT_RANGE = 100;

let cached: PublicClient | undefined;
const client = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

const HYPERSYNC_TIMEOUT_MS = 5_000;

const finalizedHead = async () => (await client().getBlock({ blockTag: "finalized" })).number;

function viemScan(contracts: readonly Address[] = WATCHED): ChainScan {
  return {
    head: finalizedHead,
    async txs(from, to) {
      if (contracts.length === 0) return [];
      const logs = await client().getLogs({ address: [...contracts], events: EVENTS, fromBlock: from, toBlock: to });
      return [...new Set(logs.map((log) => log.transactionHash))];
    },
  };
}

/**
 * Envio HyperSync when `ENVIO_API_TOKEN` is set (ADR 0051), the node's own logs when not. The token
 * is server-side only. HyperSync serves a chain at `<chain id>.hypersync.xyz`, so both flavors
 * use the same code.
 */
async function defaultScan(): Promise<ChainScan> {
  const apiToken = process.env.ENVIO_API_TOKEN?.trim();
  if (!apiToken || WATCHED.length === 0) return viemScan();
  // Loaded on demand: it is a native module the other routes have no use for.
  const { HypersyncClient } = await import("@envio-dev/hypersync-client");
  const hypersync = new HypersyncClient({
    url: `https://${CHAIN_ID}.hypersync.xyz`,
    apiToken,
    // The client's defaults (30 s, 12 retries) could outlast the route's 60 s. A connection to Envio can stall
    // for as long as its timeout; if it still can't answer, the run falls back to the node.
    httpReqTimeoutMillis: HYPERSYNC_TIMEOUT_MS,
    maxNumRetries: 3,
  });
  return withFallback(hypersyncScan(hypersync, finalizedHead, WATCHED, EVENTS.map(toEventSelector)), viemScan());
}

/** The last block the watcher has fully processed. */
export const cursorKey = () => `declub:watch:${CHAIN_ID}:fills:cursor`;
const lockKey = () => `declub:watch:${CHAIN_ID}:fills:lock`;

export type WatchOptions = {
  scan?: ChainScan;
  reader?: Reader;
  /** Where the very first run starts. Without one, it starts at the head and only follows new blocks. */
  startBlock?: bigint;
  /** Blocks per log query. */
  range?: number;
  /** Log queries in flight at once. */
  parallel?: number;
  /** No new log queries start after this many milliseconds. */
  budgetMs?: number;
  /** Passed to `recordActivity`, for tests. */
  activity?: Omit<IngestOptions, "reader">;
  now?: () => number;
};

type WatchResult =
  /** Another run holds the lock. */
  | { status: "busy" }
  | {
      status: "scanned";
      /** The last block now processed. */
      cursor: number;
      head: number;
      /** Blocks still to scan, left for the next run. */
      behind: number;
      transactions: number;
      fills: number;
      events: number;
    };

/** Scans from the cursor toward the finalized head, recording fills and Club activity on the way. */
export async function watchFills(store: Store, options: WatchOptions = {}): Promise<WatchResult> {
  const scan = options.scan ?? (await defaultScan());
  const reader = options.reader ?? viemReader();
  const parallel = Math.max(1, options.parallel ?? 4);
  const budgetMs = options.budgetMs ?? 40_000;
  const now = options.now ?? Date.now;
  const started = now();

  // Overlapping runs would only repeat work, but a backlog makes them likely, so one runs at a time.
  // The lease outlives the budget in case a run dies without releasing it.
  if ((await store.hit(lockKey(), Math.ceil(budgetMs / 1000) + 60)) > 1) return { status: "busy" };
  try {
    const head = await scan.head();
    // After `head()`: a scan that fell back to the node has a smaller range.
    const range = BigInt(Math.max(1, options.range ?? scan.range ?? DEFAULT_RANGE));
    const saved = await store.get<number | string>(cursorKey());
    let cursor: bigint;
    if (saved !== null) {
      cursor = BigInt(saved);
    } else {
      cursor = options.startBlock !== undefined ? options.startBlock - 1n : head;
      await store.set(cursorKey(), Number(cursor));
    }

    const totals = { transactions: 0, fills: 0, events: 0 };
    while (cursor < head && now() - started < budgetMs) {
      const chunks: { from: bigint; to: bigint }[] = [];
      for (let from = cursor + 1n; from <= head && chunks.length < parallel; from += range) {
        const to = from + range - 1n;
        chunks.push({ from, to: to < head ? to : head });
      }
      const found = await Promise.all(chunks.map(({ from, to }) => scan.txs(from, to)));

      // In order, and the cursor moves only past a chunk whose every transaction is recorded.
      for (const [i, { to }] of chunks.entries()) {
        for (const hash of found[i]) {
          const receipt = await reader.receipt(hash);
          // The node just returned this transaction's logs, so it has the receipt. If it says it
          // doesn't, stop here and let the next run try again.
          if (!receipt) throw new Error(`The node has logs for ${hash} but no receipt.`);
          totals.fills += await recordFills(store, receipt);
          totals.events += await recordActivity(store, hash, receipt, { ...options.activity, reader });
          totals.transactions++;
        }
        cursor = to;
        await store.set(cursorKey(), Number(cursor));
      }
    }

    return { status: "scanned", cursor: Number(cursor), head: Number(head), behind: Number(head > cursor ? head - cursor : 0n), ...totals };
  } finally {
    await store.del(lockKey()).catch(() => {});
  }
}

/** `FILL_WATCHER_START_BLOCK`, when it holds a block number. */
export function startBlockFromEnv(value = process.env.FILL_WATCHER_START_BLOCK): bigint | undefined {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? BigInt(trimmed) : undefined;
}

/**
 * True when the request carries `Authorization: Bearer <secret>`, the header Vercel Cron sends with
 * the project's `CRON_SECRET`. Any other scheduler can send the same header.
 */
export function cronAuthorized(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
