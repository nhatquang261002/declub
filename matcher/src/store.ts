import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Address, Hex } from "viem";
import { assetKey } from "./intent.ts";
import { type Intent, type Status, TERMINAL } from "./types.ts";
import { type WireIntent, intentFromWire, intentToWire } from "./wire.ts";

export interface Row {
  hash: Hex;
  maker: Address;
  intent: Intent;
  signature: Hex;
  deadline: number;
  /** Milliseconds. */
  createdAt: number;
  status: Status;
  reason: string | null;
  settlementTx: Hex | null;
}

export interface Settlement {
  txHash: Hex;
  blockNumber: number;
  /** Milliseconds. */
  at: number;
  /** Intent hashes in cycle order: `hashes[i]`'s give went to `hashes[i+1]`'s maker. */
  hashes: Hex[];
}

export interface ListFilter {
  /** `"all"` for every status. Defaults to `open`. */
  status?: Status | "all";
  maker?: Address;
  /** An `assetKey` that must be on the give / want side. */
  give?: string;
  want?: string;
  /** A token address: the intent names it, as any type or id, on either side. */
  token?: Address;
  limit?: number;
}

/**
 * SQL for "this `intent_assets` row (alias `a`) is for token `?`". The key is `type:token:id`
 * with a one-digit type, so the address starts at the third character (`assetKey`, intent.ts).
 */
const NAMES_TOKEN = "substr(a.key, 3, 42) = ?";

type DbRow = Record<string, string | number | bigint | null | Uint8Array>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS intents (
  hash          TEXT PRIMARY KEY,
  maker         TEXT NOT NULL,
  deadline      INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  status        TEXT NOT NULL,
  reason        TEXT,
  settlement_tx TEXT,
  intent        TEXT NOT NULL,
  signature     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intents_status ON intents (status, created_at);
CREATE INDEX IF NOT EXISTS intents_maker ON intents (maker);
CREATE TABLE IF NOT EXISTS intent_assets (
  hash TEXT NOT NULL,
  side TEXT NOT NULL,
  key  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intent_assets_lookup ON intent_assets (side, key);
CREATE INDEX IF NOT EXISTS intent_assets_hash ON intent_assets (hash);
CREATE TABLE IF NOT EXISTS settlements (
  tx_hash      TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL,
  at           INTEGER NOT NULL,
  hashes       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS failures (
  maker  TEXT NOT NULL,
  at     INTEGER NOT NULL,
  hash   TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS failures_maker ON failures (maker, at);
CREATE TABLE IF NOT EXISTS strikes (
  maker   TEXT NOT NULL,
  at      INTEGER NOT NULL,
  tx_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS strikes_maker ON strikes (maker, at);
CREATE TABLE IF NOT EXISTS token_bans (
  token  TEXT PRIMARY KEY,
  until  INTEGER NOT NULL,
  reason TEXT NOT NULL
);
`;

/** Where `live` left off: the last row it returned, in `(created_at, hash)` order. */
export interface LiveCursor {
  createdAt: number;
  hash: Hex;
}

export interface MatchableFilter {
  limit: number;
  /** Seconds: skip intents whose deadline is earlier. */
  minDeadline: number;
  /** Lower-case maker addresses to leave out. */
  excludeMakers?: Iterable<string>;
  /** Lower-case token addresses: leave out any intent naming one, on either side. */
  excludeTokens?: Iterable<string>;
  /** Lower-case token addresses: when set, leave out any intent naming a token not in it. */
  onlyTokens?: Iterable<string> | null;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  /** False when the hash is already in the pool (the pool never overwrites an intent). */
  insert(hash: Hex, intent: Intent, signature: Hex, now: number): boolean {
    const exists = this.db.prepare("SELECT 1 FROM intents WHERE hash = ?").get(hash);
    if (exists) return false;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO intents (hash, maker, deadline, created_at, status, intent, signature)
           VALUES (?, ?, ?, ?, 'open', ?, ?)`,
        )
        .run(hash, intent.maker.toLowerCase(), Number(intent.deadline), now, JSON.stringify(intentToWire(intent)), signature);
      const add = this.db.prepare("INSERT INTO intent_assets (hash, side, key) VALUES (?, ?, ?)");
      for (const a of intent.give) add.run(hash, "give", assetKey(a));
      for (const a of intent.want) add.run(hash, "want", assetKey(a));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return true;
  }

  get(hash: Hex): Row | null {
    const r = this.db.prepare("SELECT * FROM intents WHERE hash = ?").get(hash) as DbRow | undefined;
    return r ? toRow(r) : null;
  }

  list(f: ListFilter = {}): Row[] {
    const status = f.status ?? "open";
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (status !== "all") {
      where.push("i.status = ?");
      args.push(status);
    }
    if (f.maker) {
      where.push("i.maker = ?");
      args.push(f.maker.toLowerCase());
    }
    for (const side of ["give", "want"] as const) {
      const key = f[side];
      if (key) {
        where.push("EXISTS (SELECT 1 FROM intent_assets a WHERE a.hash = i.hash AND a.side = ? AND a.key = ?)");
        args.push(side, key.toLowerCase());
      }
    }
    if (f.token) {
      where.push(`EXISTS (SELECT 1 FROM intent_assets a WHERE a.hash = i.hash AND ${NAMES_TOKEN})`);
      args.push(f.token.toLowerCase());
    }
    const sql = `SELECT i.* FROM intents i ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY i.created_at ASC, i.hash ASC LIMIT ?`;
    args.push(Math.min(f.limit ?? 100, 500));
    return (this.db.prepare(sql).all(...args) as DbRow[]).map(toRow);
  }

  /**
   * Intents that can still change state: matched (`open`) or waiting on the chain (`stale`), in
   * `(created_at, hash)` order. `after` and `limit` page through them a slice at a time.
   */
  live(page: { after?: LiveCursor | null; limit?: number } = {}): Row[] {
    const args: SQLInputValue[] = [];
    let where = "status IN ('open', 'stale')";
    if (page.after) {
      where += " AND (created_at > ? OR (created_at = ? AND hash > ?))";
      args.push(page.after.createdAt, page.after.createdAt, page.after.hash);
    }
    let sql = `SELECT * FROM intents WHERE ${where} ORDER BY created_at, hash`;
    if (page.limit !== undefined) {
      sql += " LIMIT ?";
      args.push(page.limit);
    }
    return (this.db.prepare(sql).all(...args) as DbRow[]).map(toRow);
  }

  /** A maker's live (`open` or `stale`) intents, oldest first. */
  liveByMaker(maker: Address): Row[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM intents WHERE maker = ? AND status IN ('open', 'stale')
           ORDER BY created_at, hash`,
        )
        .all(maker.toLowerCase()) as DbRow[]
    ).map(toRow);
  }

  countLive(maker: Address): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM intents WHERE maker = ? AND status IN ('open', 'stale')").get(maker.toLowerCase()) as DbRow;
    return Number(r.n);
  }

  /**
   * The open intents the matcher may use, oldest first: not too close to their deadline, from no
   * excluded maker and naming no excluded (or, with `onlyTokens`, unlisted) token. Filtering here
   * rather than after the `LIMIT` keeps excluded intents from filling the window.
   */
  matchable(f: MatchableFilter): Row[] {
    const where = ["i.status = 'open'", "i.deadline >= ?"];
    const args: SQLInputValue[] = [f.minDeadline];
    const list = (xs: Iterable<string>) => {
      const a = [...xs];
      args.push(...a);
      return a.map(() => "?").join(", ");
    };
    const makers = [...(f.excludeMakers ?? [])];
    if (makers.length) where.push(`i.maker NOT IN (${list(makers)})`);
    const banned = [...(f.excludeTokens ?? [])];
    if (banned.length) {
      where.push(`NOT EXISTS (SELECT 1 FROM intent_assets a WHERE a.hash = i.hash AND substr(a.key, 3, 42) IN (${list(banned)}))`);
    }
    if (f.onlyTokens) {
      where.push(`NOT EXISTS (SELECT 1 FROM intent_assets a WHERE a.hash = i.hash AND substr(a.key, 3, 42) NOT IN (${list(f.onlyTokens)}))`);
    }
    args.push(f.limit);
    const sql = `SELECT i.* FROM intents i WHERE ${where.join(" AND ")}
                 ORDER BY i.created_at ASC, i.hash ASC LIMIT ?`;
    return (this.db.prepare(sql).all(...args) as DbRow[]).map(toRow);
  }

  /** Never moves an intent out of a terminal state. Returns whether it changed. */
  setStatus(hash: Hex, status: Status, reason: string | null = null, settlementTx?: Hex): boolean {
    const r = this.db
      .prepare(
        `UPDATE intents SET status = ?, reason = ?, settlement_tx = COALESCE(?, settlement_tx)
         WHERE hash = ? AND status IN ('open', 'stale')
           AND (status != ? OR reason IS NOT ?)`,
      )
      .run(status, reason, settlementTx ?? null, hash, status, reason);
    return Number(r.changes) > 0;
  }

  recordSettlement(s: Settlement) {
    this.db
      .prepare("INSERT INTO settlements (tx_hash, block_number, at, hashes) VALUES (?, ?, ?, ?)")
      .run(s.txHash, s.blockNumber, s.at, JSON.stringify(s.hashes));
  }

  /**
   * Settled cycles, newest first. `token` keeps the cycles with an intent that names that token.
   * `after` (milliseconds) keeps only later ones and returns them oldest first, so a reader can
   * page forward from where it stopped without skipping any.
   */
  settlements(f: { maker?: Address; token?: Address; after?: number; limit?: number } = {}): Settlement[] {
    const limit = Math.min(f.limit ?? 50, 200);
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (f.maker) {
      where.push("tx_hash IN (SELECT settlement_tx FROM intents WHERE maker = ?)");
      args.push(f.maker.toLowerCase());
    }
    if (f.token) {
      where.push(
        `tx_hash IN (SELECT i.settlement_tx FROM intents i JOIN intent_assets a ON a.hash = i.hash
                     WHERE i.settlement_tx IS NOT NULL AND ${NAMES_TOKEN})`,
      );
      args.push(f.token.toLowerCase());
    }
    if (f.after !== undefined) {
      where.push("at > ?");
      args.push(f.after);
    }
    const sql = `SELECT * FROM settlements ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY at ${f.after !== undefined ? "ASC" : "DESC"}, tx_hash LIMIT ?`;
    const rows = this.db.prepare(sql).all(...args, limit) as DbRow[];
    return rows.map((r) => ({
      txHash: r.tx_hash as Hex,
      blockNumber: Number(r.block_number),
      at: Number(r.at),
      hashes: JSON.parse(r.hashes as string) as Hex[],
    }));
  }

  recordFailure(maker: Address, hash: Hex, reason: string, now: number) {
    this.db.prepare("INSERT INTO failures (maker, at, hash, reason) VALUES (?, ?, ?, ?)").run(maker.toLowerCase(), now, hash, reason);
  }

  /**
   * Makers left out of matching right now: `maxFailures` or more failures since `failuresSince`,
   * or `maxStrikes` or more on-chain reverts since `strikesSince`. Lower-case.
   */
  bannedMakers(b: { failuresSince: number; maxFailures: number; strikesSince: number; maxStrikes: number }): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT maker FROM failures WHERE at >= ? GROUP BY maker HAVING COUNT(*) >= ?
         UNION
         SELECT maker FROM strikes WHERE at >= ? GROUP BY maker HAVING COUNT(*) >= ?`,
      )
      .all(b.failuresSince, b.maxFailures, b.strikesSince, b.maxStrikes) as DbRow[];
    return new Set(rows.map((r) => r.maker as string));
  }

  /** A settlement that passed its simulation reverted on-chain with this maker in the cycle. */
  recordStrike(maker: Address, txHash: Hex, now: number) {
    this.db.prepare("INSERT INTO strikes (maker, at, tx_hash) VALUES (?, ?, ?)").run(maker.toLowerCase(), now, txHash);
  }

  strikeCount(maker: Address, sinceMs: number): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM strikes WHERE maker = ? AND at >= ?").get(maker.toLowerCase(), sinceMs) as DbRow;
    return Number(r.n);
  }

  /** Leave `token` out of matching (and refuse it on posting) until `until` ms. Never shortens a ban. */
  banToken(token: Address, until: number, reason: string) {
    this.db
      .prepare(
        `INSERT INTO token_bans (token, until, reason) VALUES (?, ?, ?)
         ON CONFLICT (token) DO UPDATE SET until = MAX(until, excluded.until), reason = excluded.reason`,
      )
      .run(token.toLowerCase(), until, reason);
  }

  /** Tokens banned at `now`, lower-case. */
  bannedTokens(now: number): Set<string> {
    const rows = this.db.prepare("SELECT token FROM token_bans WHERE until > ?").all(now) as DbRow[];
    return new Set(rows.map((r) => r.token as string));
  }

  failureCount(maker: Address, sinceMs: number): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM failures WHERE maker = ? AND at >= ?").get(maker.toLowerCase(), sinceMs) as DbRow;
    return Number(r.n);
  }
}

export function isTerminal(status: Status): boolean {
  return TERMINAL.has(status);
}

function toRow(r: DbRow): Row {
  const intent = intentFromWire(JSON.parse(r.intent as string) as WireIntent);
  return {
    hash: r.hash as Hex,
    maker: intent.maker,
    intent,
    signature: r.signature as Hex,
    deadline: Number(r.deadline),
    createdAt: Number(r.created_at),
    status: r.status as Status,
    reason: (r.reason as string | null) ?? null,
    settlementTx: (r.settlement_tx as Hex | null) ?? null,
  };
}
