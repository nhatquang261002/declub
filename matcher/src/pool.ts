import type { Address, Hex } from "viem";
import { checkIntent } from "./checks.ts";
import type { Reader } from "./chain.ts";
import {
  cancelDigest,
  intentDigest,
  intentHash,
  shapeProblem,
} from "./intent.ts";
import { verifyMakerSignature } from "./signature.ts";
import type { Row, Store } from "./store.ts";
import { type Status } from "./types.ts";
import { WireError, signedFromWire } from "./wire.ts";

export class PoolError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface PoolConfig {
  chainId: number;
  swap: Address;
  /** An intent must still have this long to run when posted. */
  minTtlSec: number;
  /** ADR 0008: a short deadline is the real protection, so the pool caps how long one can be. */
  maxTtlSec: number;
}

export interface PruneReport {
  checked: number;
  changed: { hash: Hex; status: Status; reason: string | null }[];
}

/**
 * The intent pool, without HTTP. It is not authoritative: it checks that an intent is well
 * formed, signed by its maker and plausible on-chain, and keeps that true over time. The
 * contract re-checks everything at settlement, so nothing here is relied on for safety.
 */
export class Pool {
  readonly store: Store;
  readonly reader: Reader;
  readonly cfg: PoolConfig;
  private readonly onNew: () => void;
  private readonly log: (msg: string) => void;

  constructor(
    store: Store,
    reader: Reader,
    cfg: PoolConfig,
    hooks: { onNew?: () => void; log?: (msg: string) => void } = {},
  ) {
    this.store = store;
    this.reader = reader;
    this.cfg = cfg;
    this.onNew = hooks.onNew ?? (() => {});
    this.log = hooks.log ?? (() => {});
  }

  /** Validate and store a `{ intent, signature }` body. Re-posting a known intent is a no-op. */
  async submit(
    body: unknown,
    now = Date.now(),
  ): Promise<{ hash: Hex; status: Status; created: boolean }> {
    let signed;
    try {
      signed = signedFromWire(body);
    } catch (err) {
      if (err instanceof WireError) throw new PoolError(400, "bad_request", err.message);
      throw err;
    }
    const { intent, signature } = signed;

    const problem = shapeProblem(intent);
    if (problem) throw new PoolError(422, "invalid_intent", problem);

    const nowSec = Math.floor(now / 1000);
    const left = Number(intent.deadline) - nowSec;
    if (left < this.cfg.minTtlSec) {
      throw new PoolError(422, "deadline_too_soon", `needs at least ${this.cfg.minTtlSec}s left`);
    }
    if (left > this.cfg.maxTtlSec) {
      throw new PoolError(422, "deadline_too_far", `at most ${this.cfg.maxTtlSec}s ahead`);
    }

    const hash = intentHash(intent);
    const known = this.store.get(hash);
    if (known) return { hash, status: known.status, created: false };

    const digest = intentDigest(this.cfg.chainId, this.cfg.swap, intent);
    if (!(await verifyMakerSignature(this.reader, intent.maker, digest, signature))) {
      throw new PoolError(422, "bad_signature", "the signature is not valid for the maker");
    }

    const chainProblem = await checkIntent(this.reader, this.cfg.swap, intent, nowSec);
    if (chainProblem) {
      throw new PoolError(422, chainProblem.code, chainProblem.detail);
    }

    this.store.insert(hash, intent, signature, now);
    this.log(`+ ${hash.slice(0, 10)} from ${intent.maker}`);
    this.onNew();
    return { hash, status: "open", created: true };
  }

  /** Drop an intent from this pool. It does not invalidate the nonce: a copy elsewhere can still settle. */
  async cancel(hash: Hex, signature: Hex): Promise<Row> {
    const row = this.store.get(hash);
    if (!row) throw new PoolError(404, "not_found", "no such intent");
    if (row.status !== "open" && row.status !== "stale") {
      throw new PoolError(409, "not_cancellable", `the intent is already ${row.status}`);
    }
    const digest = cancelDigest(this.cfg.chainId, this.cfg.swap, hash);
    if (!(await verifyMakerSignature(this.reader, row.maker, digest, signature))) {
      throw new PoolError(403, "bad_signature", "not signed by the maker");
    }
    this.store.setStatus(hash, "cancelled");
    return this.store.get(hash)!;
  }

  /**
   * Re-check every live intent against the chain: expire the late ones, mark `stale` the ones the
   * maker can't currently honour, and revive stale ones whose assets came back. An RPC error skips
   * that intent for this pass instead of changing it.
   */
  async prune(now = Date.now()): Promise<PruneReport> {
    const nowSec = Math.floor(now / 1000);
    const report: PruneReport = { checked: 0, changed: [] };
    for (const row of this.store.live()) {
      report.checked++;
      let next: { status: Status; reason: string | null };
      try {
        const p = await checkIntent(this.reader, this.cfg.swap, row.intent, nowSec);
        next = !p
          ? { status: "open", reason: null }
          : p.code === "expired"
            ? { status: "expired", reason: null }
            : p.code === "nonce_used"
              ? { status: "consumed", reason: "nonce used on-chain" }
              : { status: "stale", reason: `${p.code}: ${p.detail}` };
      } catch (err) {
        this.log(`prune: skipped ${row.hash.slice(0, 10)}: ${(err as Error).message.split("\n")[0]}`);
        continue;
      }
      if (this.store.setStatus(row.hash, next.status, next.reason)) {
        report.changed.push({ hash: row.hash, ...next });
      }
    }
    return report;
  }
}

