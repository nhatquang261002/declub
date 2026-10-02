import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { Hex } from "viem";
import { isAddress, isHex } from "viem";
import { MAX_CYCLE } from "./intent.ts";
import { Pool, PoolError } from "./pool.ts";
import type { Row, Settlement } from "./store.ts";
import type { Status } from "./types.ts";
import { WireError, hexString, intentToWire } from "./wire.ts";

const MAX_BODY = 256 * 1024;
const STATUSES = new Set<string>([
  "open", "stale", "settled", "cancelled", "expired", "consumed", "rejected", "all",
]);

export interface ServerInfo {
  chainId: number;
  swap: string;
  matcher: string | null;
  /**
   * The protocol fee each maker pays when a cycle settles (ADR 0015). The amount can change
   * (ADR 0018), so it is read for every request.
   */
  fee: () => Promise<{ token: string; amount: string; recipient: string }>;
}

const rowJson = (r: Row) => ({
  hash: r.hash,
  status: r.status,
  reason: r.reason,
  createdAt: r.createdAt,
  settlementTx: r.settlementTx,
  intent: intentToWire(r.intent),
  signature: r.signature,
});

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "too_large", "body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "body is not valid JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    // The book is public data and nothing here uses cookies, so any web page may read it.
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

/**
 * The pool's HTTP API:
 *   GET    /info                       chain, contract, matcher address and the protocol fee
 *   POST   /intents      {intent, signature}   verify and store
 *   GET    /intents      ?status=&maker=&give=&want=&token=&limit=   the book (default: open)
 *   GET    /intents/:hash
 *   DELETE /intents/:hash   {signature}  drop it; signed by the maker over CancelIntent(hash)
 *   GET    /settlements  ?maker=&token=&after=&limit=  settled cycles, with their intents
 */
export function createPoolServer(pool: Pool, info: ServerInfo): Server {
  const settlementJson = (s: Settlement) => ({
    txHash: s.txHash,
    blockNumber: s.blockNumber,
    at: s.at,
    cycle: s.hashes.map((h) => {
      const r = pool.store.get(h);
      return r ? rowJson(r) : { hash: h };
    }),
  });

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const q = url.searchParams;

    if (req.method === "OPTIONS") return send(res, 204, null);

    if (req.method === "GET" && parts.length === 1 && parts[0] === "info") {
      return send(res, 200, { ...info, fee: await info.fee(), maxCycle: MAX_CYCLE });
    }

    if (parts[0] === "intents") {
      if (parts.length === 1 && req.method === "POST") {
        const out = await pool.submit(await readJson(req));
        return send(res, out.created ? 201 : 200, out);
      }
      if (parts.length === 1 && req.method === "GET") {
        const status = q.get("status") ?? "open";
        if (!STATUSES.has(status)) throw new HttpError(400, "bad_request", "unknown status");
        const maker = q.get("maker");
        if (maker && !isAddress(maker)) throw new HttpError(400, "bad_request", "bad maker");
        const token = q.get("token");
        if (token && !isAddress(token)) throw new HttpError(400, "bad_request", "bad token");
        const limit = q.has("limit") ? Number(q.get("limit")) : undefined;
        if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
          throw new HttpError(400, "bad_request", "bad limit");
        }
        const rows = pool.store.list({
          status: status as Status | "all",
          maker: (maker as `0x${string}` | null) ?? undefined,
          give: q.get("give") ?? undefined,
          want: q.get("want") ?? undefined,
          token: (token as `0x${string}` | null) ?? undefined,
          limit,
        });
        return send(res, 200, { intents: rows.map(rowJson) });
      }
      if (parts.length === 2) {
        const hash = parts[1]!;
        if (!isHex(hash, { strict: true }) || hash.length !== 66) {
          throw new HttpError(400, "bad_request", "bad intent hash");
        }
        if (req.method === "GET") {
          const row = pool.store.get(hash as Hex);
          if (!row) throw new HttpError(404, "not_found", "no such intent");
          return send(res, 200, rowJson(row));
        }
        if (req.method === "DELETE") {
          const body = (await readJson(req)) as { signature?: unknown } | null;
          const signature = hexString(body?.signature, "signature");
          return send(res, 200, rowJson(await pool.cancel(hash as Hex, signature)));
        }
      }
    }

    if (req.method === "GET" && parts.length === 1 && parts[0] === "settlements") {
      const maker = q.get("maker");
      if (maker && !isAddress(maker)) throw new HttpError(400, "bad_request", "bad maker");
      const token = q.get("token");
      if (token && !isAddress(token)) throw new HttpError(400, "bad_request", "bad token");
      const after = q.has("after") ? Number(q.get("after")) : undefined;
      if (after !== undefined && !(Number.isInteger(after) && after >= 0)) {
        throw new HttpError(400, "bad_request", "bad after");
      }
      const limit = q.has("limit") ? Number(q.get("limit")) : undefined;
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
        throw new HttpError(400, "bad_request", "bad limit");
      }
      const rows = pool.store.settlements({
        maker: (maker as `0x${string}` | null) ?? undefined,
        token: (token as `0x${string}` | null) ?? undefined,
        after,
        limit,
      });
      return send(res, 200, { settlements: rows.map(settlementJson) });
    }

    throw new HttpError(404, "not_found", "no such route");
  }

  return createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (err instanceof PoolError || err instanceof HttpError) {
        return send(res, err.status, { error: err.code, message: err.message });
      }
      if (err instanceof WireError) {
        return send(res, 400, { error: "bad_request", message: err.message });
      }
      console.error(err);
      send(res, 500, { error: "internal", message: "internal error" });
    });
  });
}
