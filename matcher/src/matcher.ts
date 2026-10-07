import { type Address, type Hex, isAddressEqual } from "viem";
import { intentsAbi } from "./abi.ts";
import { type Reader, type Sender, readFee } from "./chain.ts";
import { checkIntent } from "./checks.ts";
import { decodeRevert } from "./errors.ts";
import { MAX_SEARCH_STEPS, type Node, searchCycles, selectCycles } from "./graph.ts";
import { MAX_CYCLE } from "./intent.ts";
import { type Pool, intentTokens } from "./pool.ts";
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
   * succeed too, and a token can burn gas on purpose. The contract's worst case is 1.8M (with the fee): four makers, five NFTs each way.
   */
  maxGas: bigint;
  /** Edges the cycle search may look at per pass (`MAX_SEARCH_STEPS`). */
  maxSearchSteps: number;
  /** Open intents read per pass, oldest first. */
  window: number;
  /**
   * A settlement that passed its simulation but reverted on-chain is a token (or a contract
   * maker) acting differently when it counts. Every token in it that isn't allowlisted or the
   * fee token is suspended this long, and posting or matching anything naming it is refused.
   */
  tokenBanMs: number;
  /** A maker with this many such reverts inside `strikeWindowMs` is left out of matching. */
  maxStrikes: number;
  strikeWindowMs: number;
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
  maxSearchSteps: MAX_SEARCH_STEPS,
  window: 500,
  tokenBanMs: 24 * 60 * 60 * 1000,
  maxStrikes: 3,
  strikeWindowMs: 30 * 24 * 60 * 60 * 1000,
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
  /** Settlements that passed the simulation and reverted on-chain. */
  reverted: { txHash: Hex; hashes: Hex[]; bannedTokens: string[]; struck: Address[] }[];
  /** The cycle search hit its step or cycle cap at least once. */
  searchTruncated: boolean;
}

/**
 * Contract errors whose first argument is the index of the intent at fault, and what that means.
 * `WrongFee` is `stale`, not `rejected`: with a valid token it means the fee admin raised the fee
 * above the intent's `maxFee`, and a later cut would make it settleable again (ADR 0018).
 */
const BROKEN_INTENT: Record<string, Status> = {
  BadSignature: "rejected",
  WrongFee: "stale",
  InvalidMaker: "rejected",
  InvalidDeadline: "rejected",
  EmptySide: "rejected",
  TooManyAssets: "rejected",
  InvalidAsset: "rejected",
  DuplicateAsset: "rejected",
  SameAssetBothSides: "rejected",
  IntentExpired: "expired",
};

type Outcome = "settled" | "dropped" | "cooled" | "reverted";

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
    const report: MatchReport = {
      settled: [], dropped: [], cooledDown: 0, reverted: [], searchTruncated: false,
    };
    const start = Date.now();
    for (const [k, until] of this.cooldown) if (until <= start) this.cooldown.delete(k);
    for (let round = 0; round < this.cfg.maxRounds; round++) {
      const cycles = this.plan(Date.now(), report);
      if (cycles.length === 0) break;
      let progressed = false;
      for (const cycle of cycles) {
        const outcome = await this.trySettle(cycle, report);
        if (outcome === "cooled") report.cooledDown++;
        else if (outcome !== "reverted") progressed = true;
      }
      if (!progressed) break;
    }
    return report;
  }

  /**
   * Cycles worth trying right now, best first. Pure aside from reading the pool and cooldowns.
   * Banned makers, banned tokens and (with an allowlist) unlisted tokens are left out in the
   * query, so they can't take up the window.
   */
  private plan(now: number, report: MatchReport): Row[][] {
    const { store, cfg: poolCfg } = this.pool;
    const allow = poolCfg.tokenAllowlist;
    const rows = store.matchable({
      limit: this.cfg.window,
      minDeadline: Math.floor(now / 1000) + this.cfg.minRemainingSec,
      excludeMakers: store.bannedMakers({
        failuresSince: now - this.cfg.failureWindowMs,
        maxFailures: this.cfg.maxFailures,
        strikesSince: now - this.cfg.strikeWindowMs,
        maxStrikes: this.cfg.maxStrikes,
      }),
      excludeTokens: store.bannedTokens(now),
      onlyTokens: allow ? new Set([...allow, poolCfg.feeToken.toLowerCase()]) : null,
    });
    const nodes: Node[] = rows.map((r) => ({ hash: r.hash, intent: r.intent, createdAt: r.createdAt }));
    const found = searchCycles(nodes, { maxCycle: MAX_CYCLE, maxSteps: this.cfg.maxSearchSteps });
    if (found.truncated && !report.searchTruncated) {
      report.searchTruncated = true;
      this.log(`? cycle search stopped early (${found.steps} steps, ${found.cycles.length} cycles over ${nodes.length} intents)`);
    }
    // Cooling cycles go before selection, so they don't hold their makers back from other cycles.
    const ready = found.cycles.filter((c) => (this.cooldown.get(cycleKey(c.map((i) => rows[i]!))) ?? 0) <= now);
    return selectCycles(nodes, ready).map((c) => c.map((i) => rows[i]!));
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
      await this.handleOnChainRevert(cycle, txHash, report);
      return "reverted";
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
    // Intents dropped for something the maker didn't do (a fee raise), so not held against them.
    const excused = new Set<Hex>();
    const blame = (r: Row, status: Status, reason: string) =>
      offenders.set(r.hash, { hash: r.hash, status, reason });

    const revert = decodeRevert(err);
    if (revert) {
      const first = revert.args[0];
      const status = BROKEN_INTENT[revert.name];
      if (status && typeof first === "bigint" && cycle[Number(first)]) {
        const r = cycle[Number(first)]!;
        blame(r, status, revert.name);
        if (revert.name === "WrongFee") excused.add(r.hash);
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
      const fee = await readFee(this.reader, this.cfg.swap);
      for (const r of cycle) {
        const p = await checkIntent(this.reader, this.cfg.swap, r.intent, nowSec, fee);
        if (!p) continue;
        if (p.code === "wrong_fee") excused.add(r.hash);
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
      // Only the maker's own doing counts against them: running late, being settled elsewhere or
      // a fee raise doesn't.
      if ((o.status === "stale" || o.status === "rejected") && !excused.has(o.hash)) {
        this.pool.store.recordFailure(row.maker, o.hash, o.reason, Date.now());
      }
      report.dropped.push(o);
      this.log(`- dropped ${o.hash.slice(0, 10)} (${o.status}: ${o.reason})`);
    }
    return "dropped";
  }

  /**
   * The cycle passed `eth_call` and the gas estimate, then reverted on-chain, and the matcher paid
   * for it. Either state moved in between (a maker spent or revoked something), or something in
   * the cycle acts differently in a real transaction than in a simulation, which a fresh nonce
   * could repeat for free. So: suspend every token in the cycle that isn't allowlisted or the fee
   * token, and give a strike to the makers who could be behind it (those giving a suspended token,
   * and contract makers; everyone if that's nobody). A maker with `maxStrikes` is left out.
   */
  private async handleOnChainRevert(cycle: Row[], txHash: Hex, report: MatchReport) {
    const now = Date.now();
    const { store, cfg: poolCfg } = this.pool;
    const fee = poolCfg.feeToken.toLowerCase();
    const allow = poolCfg.tokenAllowlist;

    const suspect = new Set<string>();
    for (const r of cycle) {
      for (const t of intentTokens(r.intent)) if (t !== fee && !allow?.has(t)) suspect.add(t);
    }
    for (const t of suspect) store.banToken(t as Address, now + this.cfg.tokenBanMs, `settlement ${txHash} reverted on-chain`);

    const isContract = await Promise.all(
      cycle.map(async (r) => {
        try {
          const code = await this.reader.getCode({ address: r.maker });
          return code !== undefined && code !== "0x";
        } catch {
          return false;
        }
      }),
    );
    let struck = cycle.filter(
      (r, i) => isContract[i] || r.intent.give.some((a) => suspect.has(a.token.toLowerCase())),
    );
    if (struck.length === 0) struck = cycle;
    const makers = [...new Map(struck.map((r) => [r.maker.toLowerCase(), r.maker])).values()];
    for (const m of makers) store.recordStrike(m, txHash, now);

    this.cooldown.set(cycleKey(cycle), now + this.cfg.cooldownMs);
    report.reverted.push({ txHash, hashes: cycle.map((r) => r.hash), bannedTokens: [...suspect], struck: makers });
    const tag = cycle.map((r) => r.hash.slice(0, 10)).join(" → ");
    this.log(
      `! ${tag} reverted on-chain (${txHash}) after a clean simulation; ` +
        `suspended ${suspect.size ? [...suspect].join(", ") : "no token"}, strike for ${makers.join(", ")}`,
    );
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

