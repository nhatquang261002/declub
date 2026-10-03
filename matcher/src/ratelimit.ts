/**
 * An in-memory token bucket per key (an IP, a maker). Each key holds up to `burst` tokens and
 * gets `perMinute` back per minute; a request takes one. Nothing is persisted: a restart forgets
 * every bucket, which is fine for a limit whose job is to keep one client from hogging the RPC.
 */
export class RateLimiter {
  private readonly burst: number;
  private readonly perMs: number;
  private readonly maxKeys: number;
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  /** `perMinute` 0 turns the limit off. `burst` defaults to `perMinute`. */
  constructor(opts: { perMinute: number; burst?: number; maxKeys?: number }) {
    this.burst = opts.burst ?? opts.perMinute;
    this.perMs = opts.perMinute / 60_000;
    this.maxKeys = opts.maxKeys ?? 100_000;
  }

  get enabled(): boolean {
    return this.perMs > 0;
  }

  /**
   * Take one token for `key`. Returns 0 when allowed, or how many milliseconds until a token is
   * back when refused.
   */
  take(key: string, now = Date.now()): number {
    if (!this.enabled) return 0;
    let b = this.buckets.get(key);
    if (b) {
      b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * this.perMs);
      b.at = now;
    } else {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      b = { tokens: this.burst, at: now };
      this.buckets.set(key, b);
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / this.perMs);
  }

  /** Forget buckets that have refilled (they'd start full anyway); if that isn't enough, the oldest. */
  private sweep(now: number) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.at) * this.perMs >= this.burst) this.buckets.delete(k);
    }
    for (const k of this.buckets.keys()) {
      if (this.buckets.size < this.maxKeys) break;
      this.buckets.delete(k);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
