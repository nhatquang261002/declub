import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Address, type Hex, getAddress, isAddress, isHex } from "viem";

export const REPO = resolve(import.meta.dirname, "../../..");
export const CONTRACTS = resolve(REPO, "contracts");

/**
 * The repo-root `.env` the app, matcher and Foundry share; real environment variables win.
 * `E2E_ENV_FILE` points somewhere else (a separate testnet file, say).
 */
export function loadRootEnv() {
  const path = process.env.E2E_ENV_FILE?.trim() || resolve(REPO, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

export function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function addr(name: string, ...alts: string[]): Address | undefined {
  for (const n of [name, ...alts]) {
    const v = str(n);
    if (!v) continue;
    if (!isAddress(v, { strict: false })) throw new Error(`${n} is not an address: ${v}`);
    return getAddress(v);
  }
  return undefined;
}

export function needAddr(name: string, ...alts: string[]): Address {
  const v = addr(name, ...alts);
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function key(name: string): Hex | undefined {
  const v = str(name);
  if (!v) return undefined;
  const k = (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  if (!isHex(k) || k.length !== 66) throw new Error(`${name} must be a 32-byte hex private key`);
  return k;
}

export function big(name: string): bigint | undefined {
  const v = str(name);
  return v ? BigInt(v) : undefined;
}

/** `--name value` or `--name=value` from argv; `--flag` alone is "true". */
export function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}`) {
      const next = argv[i + 1];
      return next && !next.startsWith("--") ? next : "true";
    }
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}
