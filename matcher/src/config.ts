import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Address, type Hex, isAddress, isHex } from "viem";

/**
 * The same repo-root `.env` the web app and Foundry use; real environment variables win.
 * `MATCHER_ENV_FILE` points somewhere else (the tests use a path that doesn't exist, so a
 * developer's own `.env` can't leak into them).
 */
export function loadRootEnv() {
  const path = process.env.MATCHER_ENV_FILE?.trim() || resolve(import.meta.dirname, "../../.env");
  if (existsSync(path)) process.loadEnvFile(path);
}

const CANONICAL_MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

export interface Config {
  chainId: number;
  rpcUrl: string;
  multicall3?: Address;
  swap: Address;
  privateKey: Hex;
  host: string;
  port: number;
  dbPath: string;
  pollMs: number;
  pruneMs: number;
  /** Live intents one maker may have in the pool. */
  maxIntentsPerMaker: number;
  /** Intents re-checked per prune pass. */
  pruneBatch: number;
  /** Edges the cycle search may look at per pass. */
  maxSearchSteps: number;
  /** `POST`/`DELETE` requests per minute per client IP, and intents per minute per maker; 0 is off. */
  rateLimitIp: number;
  rateLimitMaker: number;
  /** Read the client IP from `X-Forwarded-For` (only behind a proxy that sets it). */
  trustProxy: boolean;
  /** Lower-case token addresses; null means any token. */
  tokenAllowlist: Set<string> | null;
  /** How long a token whose settlement reverted on-chain is suspended. */
  tokenBanMs: number;
  /** On-chain reverts after which a maker is left out (within 30 days). */
  maxStrikes: number;
}

function need(name: string, ...alts: string[]): string {
  for (const n of [name, ...alts]) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  throw new Error(`${name} is required (set it in the repo-root .env)`);
}

function int(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Like `int`, but 0 is allowed (it turns the thing off). */
function count(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function flag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v || v === "0" || v === "false" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes") return true;
  throw new Error(`${name} must be true or false`);
}

/** A comma-separated list of addresses, lower-cased; unset or empty means no list. */
function addressList(name: string): Set<string> | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  const out = new Set<string>();
  for (const part of v.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!isAddress(part, { strict: false })) throw new Error(`${name}: ${part} is not an address`);
    out.add(part.toLowerCase());
  }
  return out.size ? out : null;
}

export function loadConfig(): Config {
  const swap = need("NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS");
  if (!isAddress(swap)) throw new Error("NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS is not an address");
  const key = need("MATCHER_PRIVATE_KEY");
  if (!isHex(key, { strict: true }) || key.length !== 66) {
    throw new Error("MATCHER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  }
  const chainId = int("NEXT_PUBLIC_CHAIN_ID", 10143);
  const multicall = process.env.MULTICALL3_ADDRESS?.trim();
  return {
    chainId,
    rpcUrl: need("MATCHER_RPC_URL", "NEXT_PUBLIC_RPC_URL"),
    // Monad testnet and mainnet have Multicall3 at the canonical address; any other chain must opt in.
    multicall3: multicall
      ? (multicall as Address)
      : chainId === 10143 || chainId === 143
        ? CANONICAL_MULTICALL3
        : undefined,
    swap,
    privateKey: key,
    // Loopback by default: this process holds a funded key. Set MATCHER_HOST=0.0.0.0 to expose the pool.
    host: process.env.MATCHER_HOST?.trim() || "127.0.0.1",
    port: int("MATCHER_PORT", 8787),
    dbPath: process.env.MATCHER_DB_PATH?.trim() || resolve(import.meta.dirname, "../data/pool.sqlite"),
    pollMs: int("MATCHER_POLL_MS", 5000),
    pruneMs: int("MATCHER_PRUNE_MS", 30000),
    maxIntentsPerMaker: int("MATCHER_MAX_INTENTS_PER_MAKER", 20),
    pruneBatch: int("MATCHER_PRUNE_BATCH", 500),
    maxSearchSteps: int("MATCHER_MAX_SEARCH_STEPS", 200_000),
    rateLimitIp: count("MATCHER_RATE_LIMIT_IP", 60),
    rateLimitMaker: count("MATCHER_RATE_LIMIT_MAKER", 20),
    trustProxy: flag("MATCHER_TRUST_PROXY"),
    tokenAllowlist: addressList("MATCHER_TOKEN_ALLOWLIST"),
    tokenBanMs: int("MATCHER_TOKEN_BAN_MS", 24 * 60 * 60 * 1000),
    maxStrikes: int("MATCHER_MAX_STRIKES", 3),
  };
}
