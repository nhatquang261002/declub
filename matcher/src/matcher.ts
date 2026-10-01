import { type Address, type Hex, isAddressEqual } from "viem";
import { intentsAbi } from "./abi.ts";
import type { Reader, Sender } from "./chain.ts";
import { checkIntent } from "./checks.ts";
import { decodeRevert } from "./errors.ts";
import { type Node, findCycles, selectCycles } from "./graph.ts";
import { MAX_CYCLE } from "./intent.ts";
import type { Pool } from "./pool.ts";
import type { Row } from "./store.ts";
import type { Status } from "./types.ts";

export interface MatcherConfig {
  swap: Address;
  /** Skip intents closer to their deadline than this: the transaction may not land in time. */
  minRemainingSec: number;
  /** A maker with this many failures inside `failureWindowMs` is left out of matching. */
  maxFailures: number;
  failureWindowMs: number;
  /** How long a cycle that failed for an unknown reason is skipped. */
  cooldownMs: number;
  /** Re-match passes per `runOnce`, so a pool full of broken intents can't loop forever. */
  maxRounds: number;
  /** Percent added to the gas estimate. Monad charges the gas limit, not gas used, so keep it small. */
  gasBufferPct: bigint;
  /**
   * Refuse to send a cycle that needs more gas than this. The matcher pays for settlements that
   * succeed too, and a token can burn gas on purpose. The contract's worst case is 3.4M (with the fee).
   */
  maxGas: bigint;
}

export const defaultMatcherConfig = (swap: Address): MatcherConfig => ({
  swap,
  minRemainingSec: 10,
  maxFailures: 3,
  failureWindowMs: 60 * 60 * 1000,
  cooldownMs: 60 * 1000,
  maxRounds: 20,
  gasBufferPct: 10n,
  maxGas: 5_000_000n,
});

export interface Dropped {
  hash: Hex;
  status: Status;
  reason: string;
}

export interface MatchReport {
  settled: { txHash: Hex; hashes: Hex[] }[];
  dropped: Dropped[];
  /** Cycles skipped because they failed for a reason that couldn't be pinned on one intent. */
  cooledDown: number;
}

/** Contract errors whose first argument is the index of the intent at fault, and what that means. */
const BROKEN_INTENT: Record<string, Status> = {
  BadSignature: "rejected",
  WrongFee: "rejected",
  InvalidMaker: "rejected",
  InvalidDeadline: "rejected",
  EmptySide: "rejected",
  TooManyAssets: "rejected",
  InvalidAsset: "rejected",
  DuplicateAsset: "rejected",
  SameAssetBothSides: "rejected",
  IntentExpired: "expired",
};

type Outcome = "settled" | "dropped" | "cooled";

/**
 * Finds cycles of intents that satisfy each other (ADR 0008 pairs, ADR 0009 rings), checks each
 * with an `eth_call` of `settle`, and only then sends it. Nothing here is trusted for safety: the
 * contract re-verifies every signature, nonce and transfer. What this adds is liveness, and not
 * wasting gas on settlements that revert.
 */
export class Matcher {
  private readonly pool: Pool;
  private readonly reader: Reader;
  private readonly sender: Sender;
  private readonly cfg: MatcherConfig;
  private readonly log: (msg: string) => void;
  private readonly cooldown = new Map<string, number>();
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(
    pool: Pool,
    sender: Sender,
    cfg: MatcherConfig,
    log: (msg: string) => void = () => {},
  ) {
    this.pool = pool;
    this.reader = pool.reader;
    this.sender = sender;
    this.cfg = cfg;
    this.log = log;
  }

  /** One matching pass: settle what can be settled, drop what can't, repeat until nothing changes. */
  async runOnce(): Promise<MatchReport> {
    const report: MatchReport = { settled: [], dropped: [], cooledDown: 0 };
    for (let round = 0; round < this.cfg.maxRounds; round++) {
      const cycles = this.plan(Date.now());
      if (cycles.length === 0) break;
      let progressed = false;
      for (const cycle of cycles) {
        const outcome = await this.trySettle(cycle, report);
        if (outcome === "cooled") report.cooledDown++;
        else progressed = true;
      }
      if (!progressed) break;
    }
    return report;
  }

  /** Cycles worth trying right now, best first. Pure aside from reading the pool and cooldowns. */
  private plan(now: number): Row[][] {
    const minDeadline = Math.floor(now / 1000) + this.cfg.minRemainingSec;
    const banned = new Map<string, boolean>();
    const usable = (r: Row) => {
      if (r.deadline < minDeadline) return false;
      const k = r.maker.toLowerCase();
      let b = banned.get(k);
      if (b === undefined) {
        b = this.pool.store.failureCount(r.maker, now - this.cfg.failureWindowMs) >= this.cfg.maxFailures;
        banned.set(k, b);
      }
      return !b;
    };

    const rows = this.pool.store.list({ status: "open", limit: 500 }).filter(usable);
    const nodes: Node[] = rows.map((r) => ({ hash: r.hash, intent: r.intent, createdAt: r.createdAt }));
    return selectCycles(nodes, findCycles(nodes, { maxCycle: MAX_CYCLE }))
      .map((c) => c.map((i) => rows[i]!))
      .filter((c) => (this.cooldown.get(cycleKey(c)) ?? 0) <= now);
  }

  private async trySettle(cycle: Row[], report: MatchReport): Promise<Outcome> {
    const args = [cycle.map((r) => r.intent), cycle.map((r) => r.signature)] as const;
    const tag = cycle.map((r) => r.hash.slice(0, 10)).join(" → ");

    let gas: bigint;
    try {
      // The eth_call is the check. The gas estimate runs the same code, so a revert there is a
      // failed simulation too (state can move between the two calls).
      await this.reader.simulateContract({
        address: this.cfg.swap,
        abi: intentsAbi,
        functionName: "settle",
        args,
        account: this.sender.account,
      });
      gas = await this.reader.estimateContractGas({
        address: this.cfg.swap,
        abi: intentsAbi,
        functionName: "settle",
        args,
        account: this.sender.account,
      });
    } catch (err) {
      return this.handleFailure(cycle, err, report);
    }

    if (gas > this.cfg.maxGas) {
      this.log(`? ${tag} needs ${gas} gas, over the ${this.cfg.maxGas} cap; skipping it for a while`);
      this.cooldown.set(cycleKey(cycle), Date.now() + this.cfg.cooldownMs);
      return "cooled";
    }

    const txHash = await this.sender.wallet.writeContract({
      address: this.cfg.swap,
      abi: intentsAbi,
      functionName: "settle",
      args,
      gas: (gas * (100n + this.cfg.gasBufferPct)) / 100n,
    });
    const receipt = await this.reader.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      // It passed the simulation but reverted on-chain: state moved in between.
      this.log(`! ${tag} reverted on-chain (${txHash})`);
      this.cooldown.set(cycleKey(cycle), Date.now() + this.cfg.cooldownMs);
      return "cooled";
    }

    const hashes = cycle.map((r) => r.hash);
    for (const r of cycle) this.pool.store.setStatus(r.hash, "settled", null, txHash);
    this.pool.store.recordSettlement({
      txHash,
      blockNumber: Number(receipt.blockNumber),
      at: Date.now(),
      hashes,
    });
    report.settled.push({ txHash, hashes });
    this.log(`✓ settled ${cycle.length}-cycle ${tag} in ${txHash}`);
    return "settled";
  }

  /**
   * A simulation failed. Pin it on one or more intents if possible, drop those and let the next
   * round re-match without them; otherwise skip this exact cycle for a while.
   */
  private async handleFailure(cycle: Row[], err: unknown, report: MatchReport): Promise<Outcome> {
    const offenders = new Map<Hex, Dropped>();
    const blame = (r: Row, status: Status, reason: string) =>
      offenders.set(r.hash, { hash: r.hash, status, reason });

    const revert = decodeRevert(err);
    if (revert) {
      const first = revert.args[0];
      const status = BROKEN_INTENT[revert.name];
      if (status && typeof first === "bigint" && cycle[Number(first)]) {
        blame(cycle[Number(first)]!, status, revert.name);
      } else if (revert.name === "NonceUsed") {
        const [maker, nonce] = revert.args as [Address, bigint];
        const r = cycle.find((c) => isAddressEqual(c.maker, maker) && c.intent.nonce === nonce);
        if (r) blame(r, "consumed", "NonceUsed");
      } else if (revert.name === "UnsupportedToken" || revert.name === "NftNotReceived") {
        // A token that doesn't deliver what it was asked to: any intent giving it can't settle.
        const token = revert.args[0] as Address;
        for (const r of cycle) {
          if (r.intent.give.some((a) => isAddressEqual(a.token, token))) {
            blame(r, "rejected", revert.name);
          }
        }
      }
    }

    if (offenders.size === 0) {
      // A token-level revert (no balance, allowance or ownership) doesn't say whose. Ask the chain.
      const nowSec = Math.floor(Date.now() / 1000);
      for (const r of cycle) {
        const p = await checkIntent(this.reader, this.cfg.swap, r.intent, nowSec);
        if (!p) continue;
        blame(
          r,
          p.code === "expired" ? "expired" : p.code === "nonce_used" ? "consumed" : "stale",
          p.code === "expired" || p.code === "nonce_used" ? p.code : `${p.code}: ${p.detail}`,
        );
      }
    }

    if (offenders.size === 0) {
      const why = revert ? revert.name : ((err as Error).message ?? "").split("\n")[0];
      this.log(`? cycle failed and no intent is to blame (${why}); skipping it for a while`);
      this.cooldown.set(cycleKey(cycle), Date.now() + this.cfg.cooldownMs);
      return "cooled";
    }

    for (const o of offenders.values()) {
      const row = cycle.find((r) => r.hash === o.hash)!;
      if (!this.pool.store.setStatus(o.hash, o.status, o.reason)) continue;
      // Only the maker's own doing counts against them: running late or being settled elsewhere doesn't.
      if (o.status === "stale" || o.status === "rejected") {
        this.pool.store.recordFailure(row.maker, o.hash, o.reason, Date.now());
      }
      report.dropped.push(o);
      this.log(`- dropped ${o.hash.slice(0, 10)} (${o.status}: ${o.reason})`);
    }
    return "dropped";
  }

  // ── Background loop ──────────────────────────────────────────────────────

  start(opts: { pollMs: number; pruneMs: number }) {
    this.stopped = false;
    let lastPrune = 0;
    const tick = async () => {
      if (this.stopped || this.running) return;
      this.running = true;
      try {
        if (Date.now() - lastPrune >= opts.pruneMs) {
          lastPrune = Date.now();
          const p = await this.pool.prune();
          if (p.changed.length) this.log(`prune: ${p.changed.length} of ${p.checked} changed`);
        }
        await this.runOnce();
      } catch (err) {
        this.log(`matcher error: ${(err as Error).message.split("\n")[0]}`);
      } finally {
        this.running = false;
        if (!this.stopped) this.timer = setTimeout(tick, opts.pollMs);
      }
    };
    this.kick = () => {
      if (this.stopped) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(tick, 200);
    };
    this.timer = setTimeout(tick, 0);
  }

  /** Run soon, e.g. when a new intent arrives. Replaced by `start`. */
  kick: () => void = () => {};

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

const cycleKey = (cycle: Row[]) =>
  cycle
    .map((r) => r.hash)
    .sort()
    .join();

