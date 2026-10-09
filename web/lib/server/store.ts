import { Redis } from "@upstash/redis";

/**
 * The one place the web server keeps state that isn't in a contract (ADR 0011): Upstash Redis over
 * its REST API, which works from serverless functions with no connection pool.
 *
 * Nothing in this store can move assets or change a trade. Most of it is small, cosmetic or
 * rebuildable (shared profiles, fill history). Club memberships (ADR 0016) are not: they exist
 * nowhere else, so losing the store loses them.
 *
 * Without credentials the store is `null` in production, and each feature that needs it switches
 * itself off. In development an in-memory copy stands in so the screens can be tried without an
 * account (it is lost on restart).
 */
export type Store = {
  get<T>(key: string): Promise<T | null>;
  /** Same order as `keys`; `null` where a key has no value. */
  getMany<T>(keys: string[]): Promise<(T | null)[]>;
  set(key: string, value: unknown): Promise<void>;
  del(...keys: string[]): Promise<void>;
  members(key: string): Promise<string[]>;
  /** Replaces the whole set. An empty list removes it. */
  setMembers(key: string, members: string[]): Promise<void>;
  addMember(key: string, member: string): Promise<void>;
  removeMember(key: string, member: string): Promise<void>;
  countMembers(key: string): Promise<number>;
  /**
   * Adds members to a ranked set (re-adding a member moves its score), then keeps only the `cap`
   * highest-scored ones, so a set can't grow without bound.
   */
  rank(key: string, entries: { member: string; score: number }[], cap: number): Promise<void>;
  /** The set's members, highest score first. */
  ranked(key: string, limit: number): Promise<string[]>;
  /** Members scored `maxScore` or less (all of them when `null`), highest score first: the next page of an endless list. */
  rankedBefore(key: string, maxScore: number | null, limit: number): Promise<string[]>;
  /** Counts a hit in a fixed window and returns the count so far, this one included. */
  hit(key: string, windowSec: number): Promise<number>;
};

function credentials(): { url: string; token: string } | null {
  // The names Upstash gives you, and the ones its Vercel integration sets.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

function upstash(redis: Redis): Store {
  return {
    get: (key) => redis.get(key),
    async getMany(keys) {
      return keys.length === 0 ? [] : redis.mget(...keys);
    },
    async set(key, value) {
      await redis.set(key, value);
    },
    async del(...keys) {
      if (keys.length > 0) await redis.del(...keys);
    },
    members: (key) => redis.smembers(key),
    async setMembers(key, members) {
      const pipeline = redis.multi().del(key);
      if (members.length > 0) pipeline.sadd(key, members[0], ...members.slice(1));
      await pipeline.exec();
    },
    async addMember(key, member) {
      await redis.sadd(key, member);
    },
    async removeMember(key, member) {
      await redis.srem(key, member);
    },
    countMembers: (key) => redis.scard(key),
    async rank(key, entries, cap) {
      if (entries.length === 0) return;
      const [first, ...rest] = entries;
      await redis
        .multi()
        .zadd(key, first, ...rest)
        // Rank 0 is the lowest score: drop everything below the `cap` highest.
        .zremrangebyrank(key, 0, -(cap + 1))
        .exec();
    },
    // The client parses JSON members back into objects; callers get the strings they stored.
    async ranked(key, limit) {
      const rows = await redis.zrange<unknown[]>(key, 0, limit - 1, { rev: true });
      return rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row)));
    },
    async rankedBefore(key, maxScore, limit) {
      // Walking down from the highest score: `max` first, then `min`.
      const rows = await redis.zrange<unknown[]>(key, maxScore ?? "+inf", "-inf", { byScore: true, rev: true, offset: 0, count: limit });
      return rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row)));
    },
    async hit(key, windowSec) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      return count;
    },
  };
}

/** An in-memory store: what development uses without credentials, and what tests use. */
export function memoryStore(): Store {
  const values = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  const ranks = new Map<string, Map<string, number>>();
  const counters = new Map<string, { count: number; until: number }>();
  return {
    async get<T>(key: string) {
      return (values.get(key) as T | undefined) ?? null;
    },
    async getMany<T>(keys: string[]) {
      return keys.map((key) => (values.get(key) as T | undefined) ?? null);
    },
    async set(key, value) {
      // Round-trip through JSON so a value is stored the way Redis would store it.
      values.set(key, JSON.parse(JSON.stringify(value)));
    },
    async del(...keys) {
      for (const key of keys) {
        values.delete(key);
        sets.delete(key);
        ranks.delete(key);
        counters.delete(key);
      }
    },
    async members(key) {
      return [...(sets.get(key) ?? [])];
    },
    async setMembers(key, members) {
      if (members.length === 0) sets.delete(key);
      else sets.set(key, new Set(members));
    },
    async addMember(key, member) {
      const set = sets.get(key) ?? new Set<string>();
      sets.set(key, set.add(member));
    },
    async removeMember(key, member) {
      const set = sets.get(key);
      set?.delete(member);
      if (set?.size === 0) sets.delete(key);
    },
    async countMembers(key) {
      return sets.get(key)?.size ?? 0;
    },
    async rank(key, entries, cap) {
      const set = ranks.get(key) ?? new Map<string, number>();
      for (const { member, score } of entries) set.set(member, score);
      const kept = [...set].sort((a, b) => b[1] - a[1]).slice(0, cap);
      ranks.set(key, new Map(kept));
    },
    async ranked(key, limit) {
      return [...(ranks.get(key) ?? [])]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([member]) => member);
    },
    async rankedBefore(key, maxScore, limit) {
      return [...(ranks.get(key) ?? [])]
        .filter(([, score]) => maxScore === null || score <= maxScore)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([member]) => member);
    },
    async hit(key, windowSec) {
      const now = Date.now();
      const current = counters.get(key);
      const next = current && current.until > now ? { ...current, count: current.count + 1 } : { count: 1, until: now + windowSec * 1000 };
      counters.set(key, next);
      return next.count;
    },
  };
}

// Kept on globalThis so a dev server's hot reloads don't empty the in-memory store.
const g = globalThis as typeof globalThis & { __declubStore?: Store | null };

/** The store, or `null` when this deployment has none (production without Upstash credentials). */
export function getStore(): Store | null {
  if (g.__declubStore !== undefined) return g.__declubStore;
  const creds = credentials();
  g.__declubStore = creds ? upstash(new Redis(creds)) : process.env.NODE_ENV !== "production" ? memoryStore() : null;
  return g.__declubStore;
}

/**
 * The caller's IP for rate limits, taken only from headers this deployment's own proxy sets:
 *
 * - On Vercel (`VERCEL` is set), the platform's `x-vercel-forwarded-for` / `x-real-ip`, which
 *   Vercel overwrites, so a client can't choose them.
 * - Behind another proxy, set TRUST_PROXY to the number of proxies in front of the app (`true`
 *   means 1): the entry that many places from the right of `x-forwarded-for` is the one the
 *   outermost trusted proxy appended. Anything to its left was written by the client.
 * - Otherwise every header is the client's word, so none is used and all callers share one bucket.
 */
export function clientId(request: Request, env: { VERCEL?: string; TRUST_PROXY?: string; [name: string]: string | undefined } = process.env): string {
  const h = request.headers;
  if (env.VERCEL) {
    const ip = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
    if (ip) return ip;
  }
  const hops = trustedHops(env.TRUST_PROXY);
  if (hops > 0) {
    const chain = (h.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = chain[chain.length - hops];
    if (ip) return ip;
  }
  return "unknown";
}

function trustedHops(value: string | undefined): number {
  const v = value?.trim().toLowerCase();
  if (!v || v === "false" || v === "0") return 0;
  if (v === "true") return 1;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** True while `id` is within `limit` hits per `windowSec`. A store that errors never blocks anyone. */
export async function withinLimit(store: Store, name: string, id: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    return (await store.hit(`declub:rl:${name}:${id}`, windowSec)) <= limit;
  } catch {
    return true;
  }
}
