import { type Address, type Hex, isAddressEqual } from "viem";
import { erc20Abi } from "./abi.ts";
import { checkIntent } from "./checks.ts";
import { type Reader, readFee } from "./chain.ts";
import { cancelDigest, feeProblem, intentDigest, intentHash, sameAsset, shapeProblem } from "./intent.ts";
import type { RateLimiter } from "./ratelimit.ts";
import { verifyMakerSignature } from "./signature.ts";
import type { LiveCursor, Row, Store } from "./store.ts";
import { AssetType, type Intent, type Status } from "./types.ts";
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
  /**
   * The token the contract charges the fee in (`FEE_TOKEN`, fixed). The amount, `fee()`, can change
   * (ADR 0018), so the pool reads it for every submission and every prune pass.
   */
  feeToken: Address;
  /** An intent must still have this long to run when posted. */
  minTtlSec: number;
  /** ADR 0008: a short deadline is the real protection, so the pool caps how long one can be. */
  maxTtlSec: number;
  /**
   * Most live (`open` or `stale`) intents one maker may have in the pool, so one maker can't fill
   * the matcher's window. Default `DEFAULT_MAX_LIVE_PER_MAKER`.
   */
  maxLivePerMaker?: number;
  /** Most intents one prune pass re-checks; the next pass carries on from there. Default 500. */
  pruneBatch?: number;
  /**
   * Lower-case token addresses. When set, only intents whose give and want tokens are all in it
   * (or are the fee token) are accepted and matched. Unset: any token.
   */
  tokenAllowlist?: ReadonlySet<string> | null;
}

export const DEFAULT_MAX_LIVE_PER_MAKER = 20;
export const DEFAULT_PRUNE_BATCH = 500;

/** The tokens an intent names in `give` and `want`, lower-case, without duplicates. */
export function intentTokens(intent: Intent): string[] {
  return [...new Set([...intent.give, ...intent.want].map((a) => a.token.toLowerCase()))];
}

/** Whether every give/want token is allowed by `allowlist` (null: no list) or is the fee token. */
export function allowedTokens(intent: Intent, allowlist: ReadonlySet<string> | null | undefined, feeToken: Address) {
  if (!allowlist) return true;
  const fee = feeToken.toLowerCase();
  return intentTokens(intent).every((t) => t === fee || allowlist.has(t));
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
  private readonly makerLimit: RateLimiter | null;
  private pruneCursor: LiveCursor | null = null;

  constructor(store: Store, reader: Reader, cfg: PoolConfig, hooks: { onNew?: () => void; log?: (msg: string) => void; makerLimit?: RateLimiter } = {}) {
    this.store = store;
    this.reader = reader;
    this.cfg = cfg;
    this.onNew = hooks.onNew ?? (() => {});
    this.log = hooks.log ?? (() => {});
    this.makerLimit = hooks.makerLimit ?? null;
  }

  /** Validate and store a `{ intent, signature }` body. Re-posting a known intent is a no-op. */
  async submit(body: unknown, now = Date.now()): Promise<{ hash: Hex; status: Status; created: boolean }> {
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
    const fee = await readFee(this.reader, this.cfg.swap);
    const wrongFee = feeProblem(intent, { token: this.cfg.feeToken, amount: fee });
    if (wrongFee) throw new PoolError(422, "wrong_fee", wrongFee);

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

    // Cheap checks first: none of these needs the chain.
    if (!allowedTokens(intent, this.cfg.tokenAllowlist, this.cfg.feeToken)) {
      throw new PoolError(422, "token_not_allowed", "this pool only matches intents in its listed tokens");
    }
    const banned = this.store.bannedTokens(now);
    const bannedToken = intentTokens(intent).find((t) => banned.has(t));
    if (bannedToken) {
      throw new PoolError(422, "token_banned", `${bannedToken} made a settlement revert on-chain and is suspended`);
    }
    const others = this.store.liveByMaker(intent.maker);
    const cap = this.cfg.maxLivePerMaker ?? DEFAULT_MAX_LIVE_PER_MAKER;
    if (others.length >= cap) {
      throw new PoolError(422, "too_many_intents", `a maker can have at most ${cap} open intents in this pool; cancel one or let it expire`);
    }
    for (const a of intent.give) {
      if (a.assetType !== AssetType.ERC721) continue;
      const twin = others.find((r) => r.intent.give.some((g) => sameAsset(g, a)));
      if (twin) {
        throw new PoolError(422, "nft_committed", `${a.token} #${a.id} is already given by open intent ${twin.hash}; cancel it first`);
      }
    }

    const digest = intentDigest(this.cfg.chainId, this.cfg.swap, intent);
    if (!(await verifyMakerSignature(this.reader, intent.maker, digest, signature))) {
      throw new PoolError(422, "bad_signature", "the signature is not valid for the maker");
    }
    // Charged only once the maker is proven, so nobody can use up someone else's allowance.
    const wait = this.makerLimit?.take(intent.maker.toLowerCase(), now) ?? 0;
    if (wait > 0) {
      throw new PoolError(429, "rate_limited", `too many intents from this maker; retry in ${Math.ceil(wait / 1000)}s`);
    }

    const chainProblem = await checkIntent(this.reader, this.cfg.swap, intent, nowSec, fee);
    if (chainProblem) {
      throw new PoolError(422, chainProblem.code, chainProblem.detail);
    }
    const committed = await this.committedProblem(intent, others);
    if (committed) throw new PoolError(422, "balance_committed", committed);

    this.store.insert(hash, intent, signature, now);
    this.log(`+ ${hash.slice(0, 10)} from ${intent.maker}`);
    this.onNew();
    return { hash, status: "open", created: true };
  }

  /**
   * The maker's other live intents and this one, together, may not give more of an ERC-20 than
   * the maker holds: otherwise one balance could back any number of intents. (Each intent alone
   * was already checked, fee included, by `checkIntent`.)
   */
  private async committedProblem(intent: Intent, others: Row[]): Promise<string | null> {
    for (const a of intent.give) {
      if (a.assetType !== AssetType.ERC20) continue;
      let committed = 0n;
      for (const r of others) {
        for (const g of r.intent.give) {
          if (g.assetType === AssetType.ERC20 && isAddressEqual(g.token, a.token)) committed += g.amount;
        }
      }
      if (committed === 0n) continue;
      const balance = await this.reader.readContract({
        address: a.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [intent.maker],
      });
      if (committed + a.amount > balance) {
        return `${a.token}: balance ${balance} < ${committed + a.amount} (${committed} already in your other open intents)`;
      }
    }
    return null;
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
   * Re-check live intents against the chain: expire the late ones, mark `stale` the ones the
   * maker can't currently honour (including a fee raised above their `maxFee`), and revive stale
   * ones whose assets came back or whose fee came down. An RPC error skips that intent for this
   * pass instead of changing it. One pass checks at most `pruneBatch` intents, oldest first, and
   * the next pass carries on after the last one, wrapping round at the end.
   */
  async prune(now = Date.now()): Promise<PruneReport> {
    const nowSec = Math.floor(now / 1000);
    const report: PruneReport = { checked: 0, changed: [] };
    let fee: bigint;
    try {
      fee = await readFee(this.reader, this.cfg.swap);
    } catch (err) {
      this.log(`prune: skipped, can't read the fee: ${(err as Error).message.split("\n")[0]}`);
      return report;
    }
    const limit = this.cfg.pruneBatch ?? DEFAULT_PRUNE_BATCH;
    let rows = this.store.live({ after: this.pruneCursor, limit });
    if (rows.length === 0 && this.pruneCursor) rows = this.store.live({ limit });
    const last = rows[rows.length - 1];
    this.pruneCursor = rows.length === limit && last ? { createdAt: last.createdAt, hash: last.hash } : null;
    for (const row of rows) {
      report.checked++;
      let next: { status: Status; reason: string | null };
      try {
        const p = await checkIntent(this.reader, this.cfg.swap, row.intent, nowSec, fee);
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
