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

export function loadConfig(): Config {
  const swap = need("NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS");
  if (!isAddress(swap)) throw new Error("NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS is not an address");
  const key = need("MATCHER_PRIVATE_KEY");
  if (!isHex(key, { strict: true }) || key.length !== 66) {
    throw new Error("MATCHER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  }
  const chainId = int("NEXT_PUBLIC_CHAIN_ID", 10143);
  const multicall = process.env.MULTICALL3_ADDRESS?.trim();
  return {
    chainId,
    rpcUrl: need("MATCHER_RPC_URL", "NEXT_PUBLIC_RPC_URL"),
    // Monad testnet has Multicall3 at the canonical address; any other chain must opt in.
    multicall3: multicall
      ? (multicall as Address)
      : chainId === 10143
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
  };
}
