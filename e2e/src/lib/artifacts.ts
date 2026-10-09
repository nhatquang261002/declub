import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Abi, Hex } from "viem";
import { CONTRACTS } from "./env.ts";

const OUT = resolve(CONTRACTS, "out");

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
  /** Byte ranges in the runtime code that the constructor fills in (immutables). */
  immutables: { start: number; length: number }[];
}

/** A contract from `contracts/out` (run `forge build` first). */
export function artifact(file: string, name = file.replace(/\..*$/, "")): Artifact {
  const path = resolve(OUT, file, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`${path} is missing: run \`forge build\` in contracts/`);
  }
  const j = JSON.parse(readFileSync(path, "utf8")) as {
    abi: Abi;
    bytecode: { object: Hex };
    deployedBytecode: { object: Hex; immutableReferences?: Record<string, { start: number; length: number }[]> };
  };
  return {
    abi: j.abi,
    bytecode: j.bytecode.object,
    deployedBytecode: j.deployedBytecode.object,
    immutables: Object.values(j.deployedBytecode.immutableReferences ?? {}).flat(),
  };
}

export const ESCROW = () => artifact("DeClubEscrow.sol");
export const INTENTS = () => artifact("DeClubIntents.sol");
export const REWARDS = () => artifact("DeClubRewards.sol");
export const MOCK_CHOG = () => artifact("MockChog.sol");
export const MOCK_ERC20 = () => artifact("MockERC20.sol");
export const MOCK_WMON = () => artifact("MockWMON.sol");
/** Test-only ERC-1271 wallet: its owner signs for it, and it has no `receive()`. */
export const WALLET_1271 = () => artifact("DeClubIntents.signatures.t.sol", "Mock1271Wallet");
