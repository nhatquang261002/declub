import { getAddress, isAddress, type Address } from "viem";
import { CHAIN_ID } from "./config";
import raw from "../data/assets.json" with { type: "json" };

/**
 * The curated list of verified and blocked assets (ADR 0014). It changes what the app shows and
 * which assets get a Club (ADR 0016), never what the contracts allow. One file, reviewed by pull
 * request, bundled into the build.
 */
export type AssetStatus = "verified" | "blocked";
/** `false` lists an asset as verified without a Club; `"archived"` keeps a Club read-only. */
export type ClubSetting = boolean | "archived";

export type AssetEntry = {
  chainId: number;
  /** Checksummed. */
  address: Address;
  kind: "erc721" | "erc20";
  name: string;
  symbol: string;
  status: AssetStatus;
  /** Why it's on the list. Required: a bare "verified" says nothing. */
  note: string;
  /** Club setting; absent means a verified asset has a Club. */
  club?: ClubSetting;
  /** ERC-20 only: the smallest balance (base units, as a decimal string) that earns the Holder badge. */
  minHolding?: string;
};

/** What a screen can say about an address: on the list, or not on it at all. */
export type AssetTier = AssetStatus | "unverified";

const STATUS = new Set(["verified", "blocked"]);
const KIND = new Set(["erc721", "erc20"]);

/** Throws on the first problem, so a bad edit to the file fails the build and the tests. */
export function parseAssets(list: unknown): AssetEntry[] {
  if (!Array.isArray(list)) throw new Error("assets.json must be an array");
  const seen = new Set<string>();
  return list.map((item, index) => {
    const at = `assets.json[${index}]`;
    if (typeof item !== "object" || item === null) throw new Error(`${at}: not an object`);
    const e = item as Record<string, unknown>;
    if (!Number.isInteger(e.chainId)) throw new Error(`${at}: chainId must be an integer`);
    if (typeof e.address !== "string" || !isAddress(e.address, { strict: false })) throw new Error(`${at}: bad address`);
    const address = getAddress(e.address);
    if (e.address !== address) throw new Error(`${at}: address must be checksummed (${address})`);
    if (typeof e.kind !== "string" || !KIND.has(e.kind)) throw new Error(`${at}: kind must be erc721 or erc20`);
    if (typeof e.status !== "string" || !STATUS.has(e.status)) throw new Error(`${at}: status must be verified or blocked`);
    if (typeof e.name !== "string" || !e.name.trim()) throw new Error(`${at}: name is empty`);
    if (typeof e.symbol !== "string" || !e.symbol.trim()) throw new Error(`${at}: symbol is empty`);
    if (typeof e.note !== "string" || !e.note.trim()) throw new Error(`${at}: note is empty`);
    if (e.club !== undefined && typeof e.club !== "boolean" && e.club !== "archived") {
      throw new Error(`${at}: club must be true, false or "archived"`);
    }
    if (e.minHolding !== undefined) {
      if (e.kind !== "erc20") throw new Error(`${at}: minHolding is only for erc20`);
      if (typeof e.minHolding !== "string" || !/^[1-9][0-9]*$/.test(e.minHolding)) {
        throw new Error(`${at}: minHolding must be a positive integer string`);
      }
    }
    const key = `${e.chainId}:${address}`;
    if (seen.has(key)) throw new Error(`${at}: ${address} is listed twice on chain ${e.chainId}`);
    seen.add(key);
    return item as AssetEntry;
  });
}

export type Registry = {
  tier(token: string, chainId?: number): AssetTier;
  /** The entry for `token`, when it is on the list. */
  entry(token: string, chainId?: number): AssetEntry | null;
  /** The Club's entry: verified, with a Club, on this chain. */
  clubFor(token: string, chainId?: number): AssetEntry | null;
  /** Every Club on the chain, archived ones included. */
  clubs(chainId?: number): AssetEntry[];
};

/** Matched by chain id and address, never by name or symbol (ADR 0014). */
export function makeRegistry(entries: AssetEntry[]): Registry {
  const byKey = new Map(entries.map((e) => [`${e.chainId}:${e.address.toLowerCase()}`, e]));
  const entry = (token: string, chainId = CHAIN_ID) => byKey.get(`${chainId}:${token.toLowerCase()}`) ?? null;
  const hasClub = (e: AssetEntry) => e.status === "verified" && e.club !== false;
  return {
    entry,
    tier: (token, chainId) => entry(token, chainId)?.status ?? "unverified",
    clubFor(token, chainId) {
      const found = entry(token, chainId);
      return found && hasClub(found) ? found : null;
    },
    clubs: (chainId = CHAIN_ID) => entries.filter((e) => e.chainId === chainId && hasClub(e)),
  };
}

export const ASSETS = parseAssets(raw);
export const registry = makeRegistry(ASSETS);
