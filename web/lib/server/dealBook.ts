import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";
import { deClubEscrowAbi } from "../abi";
import type { TokenLabel } from "../assets";
import { chain } from "../chain";
import { DECLUB_INTENTS_ADDRESS, DECLUB_ESCROW_ADDRESS, RPC_URL } from "../config";
import type { BookSource } from "../dealBook";
import { toDeal, type Deal } from "../deals";
import { intentAsListing, type PoolIntent } from "../intents";
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
 * - Symbols and names never change either, so each token or NFT collection is read once (one that
 *   doesn't answer is tried again after a while). Signed swaps are read the same way as locked deals.
 *
 * All of it lives in this server instance's memory: a cold start reads the book again. The chain
 * stays the source of truth, and every action re-reads the deal before sending.
 */

/** The chain reads the book makes. Real in production (`viemBookReader`), a fake in tests. */
export type BookReader = {
  tradeCount(): Promise<bigint>;
  /** Same order as `ids`. null where a deal can't be read or uses an asset type this build doesn't know. */
  trades(ids: readonly bigint[]): Promise<(Deal | null)[]>;
  /** Symbol and name of each token or NFT collection that answers. */
  tokenInfo(tokens: readonly Address[]): Promise<Map<string, TokenLabel>>;
};

/** The pool's book (matcher/). null when the intents contract isn't configured. */
type IntentReader = ((status: "open" | "all") => Promise<PoolIntent[]>) | null;

type BookOptions = {
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
const NAME_CHARS = 48;

export function createBook(reader: BookReader, intents: IntentReader, options: BookOptions = {}): Book {
  const ttlMs = options.ttlMs ?? 5_000;
  const batch = Math.max(1, options.batch ?? 100);
  const parallel = Math.max(1, options.parallel ?? 4);
  const tokenRetryMs = options.tokenRetryMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;

  const closed = new Map<bigint, Deal>();
  const tokens = new Map<string, TokenLabel>();
  const tokenMisses = new Map<string, number>();
  let deals: { at: number; list: Deal[] } | null = null;
  let refreshing: Promise<Deal[]> | null = null;
  const pool = new Map<"open" | "all", { at: number; rows: PoolIntent[] }>();
  const polling = new Map<"open" | "all", Promise<PoolIntent[]>>();

  async function readDeals(): Promise<Deal[]> {
    const total = await reader.tradeCount();
    const stale: bigint[] = [];
    for (let id = total; id >= 1n; id--) if (!closed.has(id)) stale.push(id);

    const fresh = new Map<bigint, Deal>();
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

    const list: Deal[] = [];
    for (let id = total; id >= 1n; id--) {
      const deal = closed.get(id) ?? fresh.get(id);
      if (deal) list.push(deal);
    }
    await readTokens(list);
    return list;
  }

  async function readTokens(list: readonly Pick<Deal, "offered" | "requested">[]) {
    const wanted = new Set<string>();
    for (const deal of list) {
      for (const a of [...deal.offered, ...deal.requested]) {
        const key = a.token.toLowerCase();
        if (a.kind === "native" || tokens.has(key)) continue;
        const missed = tokenMisses.get(key);
        if (missed === undefined || now() - missed > tokenRetryMs) wanted.add(key);
      }
    }
    if (wanted.size === 0) return;
    const asked = [...wanted] as Address[];
    // A token list that can't be read costs the search its symbols, not the book.
    const found = await reader.tokenInfo(asked).catch(() => new Map<string, TokenLabel>());
    for (const token of asked) {
      const info = found.get(token);
      if (info) {
        tokens.set(token, { symbol: info.symbol.slice(0, SYMBOL_CHARS), name: info.name.slice(0, NAME_CHARS) });
        tokenMisses.delete(token);
      } else {
        tokenMisses.set(token, now());
      }
    }
  }

  async function currentDeals(): Promise<Deal[]> {
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
        currentIntents("open").then(
          (rows) => ({ rows, error: null }),
          (error: unknown) => ({ rows: [], error }),
        ),
        tab === "all"
          ? currentIntents("all").then(
              (rows) => ({ rows, error: null }),
              (error: unknown) => ({ rows: [], error }),
            )
          : Promise.resolve(null),
      ]);
      const failed = open.error ?? all?.error;
      const openSigned = open.rows.map(intentAsListing);
      const allSigned = all ? all.rows.map(intentAsListing) : openSigned;
      await readTokens(allSigned);
      return {
        deals: list,
        openSigned,
        allSigned,
        info: tokens,
        signedError: failed ? (failed instanceof Error ? failed.message : "The intent pool couldn't be read.") : null,
      };
    },
  };
}

let cachedClient: PublicClient | undefined;
const client = () => (cachedClient ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

function viemBookReader(contract: Address): BookReader {
  return {
    tradeCount: () => client().readContract({ address: contract, abi: deClubEscrowAbi, functionName: "tradeCount" }),
    async trades(ids) {
      const results = await client().multicall({
        contracts: ids.map((id) => ({ address: contract, abi: deClubEscrowAbi, functionName: "getTrade", args: [id] }) as const),
        allowFailure: true,
      });
      return results.map((r, i) => (r.status === "success" ? toDeal(ids[i], r.result) : null));
    },
    async tokenInfo(list) {
      const results = await client().multicall({
        contracts: list.flatMap(
          (address) =>
            [
              { address, abi: erc20Abi, functionName: "symbol" },
              { address, abi: erc20Abi, functionName: "name" },
            ] as const,
        ),
        allowFailure: true,
      });
      const out = new Map<string, TokenLabel>();
      list.forEach((token, i) => {
        const symbol = results[i * 2];
        const name = results[i * 2 + 1];
        // ERC-721 metadata is optional, so a collection may give one of the two. The same selectors serve ERC-20 and ERC-721.
        if (symbol?.status === "success" || name?.status === "success") {
          out.set(token.toLowerCase(), {
            symbol: symbol?.status === "success" ? String(symbol.result) : "",
            name: name?.status === "success" ? String(name.result) : "",
          });
        }
      });
      return out;
    },
  };
}

// Kept on globalThis so a dev server's hot reloads don't drop the book.
const g = globalThis as typeof globalThis & { __declubBook?: Book | null };

/** The live book, or null when there is no deal contract to read. */
export function getBook(): Book | null {
  if (g.__declubBook !== undefined) return g.__declubBook;
  g.__declubBook = DECLUB_ESCROW_ADDRESS
    ? createBook(viemBookReader(DECLUB_ESCROW_ADDRESS), DECLUB_INTENTS_ADDRESS ? (status) => listIntents({ status }) : null)
    : null;
  return g.__declubBook;
}
