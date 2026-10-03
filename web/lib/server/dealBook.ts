import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";
import { onDealV2Abi } from "../abi";
import type { TokenInfo } from "../assets";
import { chain } from "../chain";
import { ON_DEAL_INTENTS_ADDRESS, ON_DEAL_V2_ADDRESS, RPC_URL } from "../config";
import type { BookSource } from "../dealBook";
import { toDealV2, type DealV2 } from "../dealsV2";
import { demoDealsV2, demoIntents, demoTokenInfo } from "../demoDeals";
import { intentAsListing, isLive, type PoolIntent } from "../intents";
import { listIntents } from "../pool";

/**
 * The whole deal book, held by the server so it can be searched and filtered past the newest 200
 * deals a browser reads (ADR 0020). There is no indexer and the public RPC can't scan logs (ADR
 * 0004), so this reads contract storage the way the browser does, once for everyone:
 *
 * - A filled or cancelled deal never changes again, so it is read once and kept.
 * - Open deals (expired ones included, until reclaimed) are read again on each refresh, along with
 *   `tradeCount` for the new ones. A refresh happens at most every `ttlMs`, and requests that arrive
 *   during one share it.
 * - Token symbols never change either, so each token is read once (a token that doesn't answer is
 *   tried again after a while).
 *
 * All of it lives in this server instance's memory: a cold start reads the book again. The chain
 * stays the source of truth, and every action re-reads the deal before sending.
 */

/** The chain reads the book makes. Real in production (`viemBookReader`), a fake in tests. */
export type BookReader = {
  tradeCount(): Promise<bigint>;
  /** Same order as `ids`. null where a deal can't be read or uses an asset type this build doesn't know. */
  trades(ids: readonly bigint[]): Promise<(DealV2 | null)[]>;
  /** Symbol and decimals of each token that answers. */
  tokenInfo(tokens: readonly Address[]): Promise<Map<string, TokenInfo>>;
};

/** The pool's book (matcher/). null when the intents contract isn't configured. */
export type IntentReader = ((status: "open" | "all") => Promise<PoolIntent[]>) | null;

export type BookOptions = {
  /** How old the book may get before a request refreshes it. */
  ttlMs?: number;
  /** `getTrade` reads per multicall. A deal holds up to 20 assets, so this keeps a response small. */
  batch?: number;
  /** Multicalls in flight at once. */
  parallel?: number;
  /** How long a token that didn't answer is left alone. */
  tokenRetryMs?: number;
  now?: () => number;
};

export type Book = {
  /** The book as of at most `ttlMs` ago. `signedError` says why signed swaps are missing. */
  source(tab: "open" | "all"): Promise<BookSource & { signedError: string | null }>;
};

const SYMBOL_CHARS = 12;

export function createBook(reader: BookReader, intents: IntentReader, options: BookOptions = {}): Book {
  const ttlMs = options.ttlMs ?? 5_000;
  const batch = Math.max(1, options.batch ?? 100);
  const parallel = Math.max(1, options.parallel ?? 4);
  const tokenRetryMs = options.tokenRetryMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;

  const closed = new Map<bigint, DealV2>();
  const tokens = new Map<string, TokenInfo>();
  const tokenMisses = new Map<string, number>();
  let deals: { at: number; list: DealV2[] } | null = null;
  let refreshing: Promise<DealV2[]> | null = null;
  const pool = new Map<"open" | "all", { at: number; rows: PoolIntent[] }>();
  const polling = new Map<"open" | "all", Promise<PoolIntent[]>>();

  async function readDeals(): Promise<DealV2[]> {
    const total = await reader.tradeCount();
    const stale: bigint[] = [];
    for (let id = total; id >= 1n; id--) if (!closed.has(id)) stale.push(id);

    const fresh = new Map<bigint, DealV2>();
    let next = 0;
    await Promise.all(
      Array.from({ length: parallel }, async () => {
        while (next < stale.length) {
          const ids = stale.slice(next, (next += batch));
          const read = await reader.trades(ids);
          read.forEach((deal, i) => {
            if (!deal) return;
            if (deal.status === "open") fresh.set(ids[i], deal);
            else closed.set(ids[i], deal);
          });
        }
      }),
    );

    const list: DealV2[] = [];
    for (let id = total; id >= 1n; id--) {
      const deal = closed.get(id) ?? fresh.get(id);
      if (deal) list.push(deal);
    }
    await readTokens(list);
    return list;
  }

  async function readTokens(list: readonly DealV2[]) {
    const wanted = new Set<string>();
    for (const deal of list) {
      for (const a of [...deal.offered, ...deal.requested]) {
        const key = a.token.toLowerCase();
        if (a.kind !== "erc20" || tokens.has(key)) continue;
        const missed = tokenMisses.get(key);
        if (missed === undefined || now() - missed > tokenRetryMs) wanted.add(key);
      }
    }
    if (wanted.size === 0) return;
    const asked = [...wanted] as Address[];
    // A token list that can't be read costs the search its symbols, not the book.
    const found = await reader.tokenInfo(asked).catch(() => new Map<string, TokenInfo>());
    for (const token of asked) {
      const info = found.get(token);
      if (info) {
        tokens.set(token, { symbol: info.symbol.slice(0, SYMBOL_CHARS), decimals: info.decimals });
        tokenMisses.delete(token);
      } else {
        tokenMisses.set(token, now());
      }
    }
  }

  async function currentDeals(): Promise<DealV2[]> {
    if (deals && now() - deals.at < ttlMs) return deals.list;
    refreshing ??= readDeals()
      .then((list) => {
        deals = { at: now(), list };
        return list;
      })
      .finally(() => {
        refreshing = null;
      });
    try {
      return await refreshing;
    } catch (error) {
      // A failed refresh serves the last book it had, if any.
      if (deals) return deals.list;
      throw error;
    }
  }

  async function currentIntents(status: "open" | "all"): Promise<PoolIntent[]> {
    if (!intents) return [];
    const cached = pool.get(status);
    if (cached && now() - cached.at < ttlMs) return cached.rows;
    let running = polling.get(status);
    if (!running) {
      running = intents(status)
        .then((rows) => {
          pool.set(status, { at: now(), rows });
          return rows;
        })
        .finally(() => polling.delete(status));
      polling.set(status, running);
    }
    return running;
  }

  return {
    async source(tab) {
      const [list, open, all] = await Promise.all([
        currentDeals(),
        currentIntents("open").then((rows) => ({ rows, error: null }), (error: unknown) => ({ rows: [], error })),
        tab === "all"
          ? currentIntents("all").then((rows) => ({ rows, error: null }), (error: unknown) => ({ rows: [], error }))
          : Promise.resolve(null),
      ]);
      const failed = open.error ?? all?.error;
      return {
        deals: list,
        openSigned: open.rows.map(intentAsListing),
        allSigned: (all ?? open).rows.map(intentAsListing),
        info: tokens,
        signedError: failed ? (failed instanceof Error ? failed.message : "The intent pool couldn't be read.") : null,
      };
    },
  };
}

let cachedClient: PublicClient | undefined;
const client = () => (cachedClient ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

export function viemBookReader(contract: Address): BookReader {
  return {
    tradeCount: () => client().readContract({ address: contract, abi: onDealV2Abi, functionName: "tradeCount" }),
    async trades(ids) {
      const results = await client().multicall({
        contracts: ids.map((id) => ({ address: contract, abi: onDealV2Abi, functionName: "getTrade", args: [id] }) as const),
        allowFailure: true,
      });
      return results.map((r, i) => (r.status === "success" ? toDealV2(ids[i], r.result) : null));
    },
    async tokenInfo(list) {
      const results = await client().multicall({
        contracts: list.flatMap((address) => [
          { address, abi: erc20Abi, functionName: "symbol" },
          { address, abi: erc20Abi, functionName: "decimals" },
        ] as const),
        allowFailure: true,
      });
      const out = new Map<string, TokenInfo>();
      list.forEach((token, i) => {
        const symbol = results[i * 2];
        const decimals = results[i * 2 + 1];
        if (symbol?.status === "success" && decimals?.status === "success") {
          out.set(token.toLowerCase(), { symbol: String(symbol.result), decimals: Number(decimals.result) });
        }
      });
      return out;
    },
  };
}

/** The mock deals (lib/demoDeals.ts), cast for `viewer` the way the browser casts them. */
export function demoSource(viewer: Address | undefined, tab: "open" | "all"): BookSource & { signedError: null } {
  const rows = demoIntents(viewer);
  const info = new Map<string, TokenInfo>();
  const deals = demoDealsV2(viewer);
  for (const deal of deals) {
    for (const a of [...deal.offered, ...deal.requested]) {
      const known = a.kind === "erc20" && demoTokenInfo(a.token);
      if (known) info.set(a.token.toLowerCase(), known);
    }
  }
  const open = rows.filter((r) => isLive(r.status)).map(intentAsListing);
  return { deals, openSigned: open, allSigned: tab === "all" ? rows.map(intentAsListing) : open, info, signedError: null };
}

// Kept on globalThis so a dev server's hot reloads don't drop the book.
const g = globalThis as typeof globalThis & { __ondealBook?: Book | null };

/** The live book, or null when there is no deal contract to read (and no mock deals). */
export function getBook(): Book | null {
  if (g.__ondealBook !== undefined) return g.__ondealBook;
  g.__ondealBook = ON_DEAL_V2_ADDRESS
    ? createBook(viemBookReader(ON_DEAL_V2_ADDRESS), ON_DEAL_INTENTS_ADDRESS ? (status) => listIntents({ status }) : null)
    : null;
  return g.__ondealBook;
}
