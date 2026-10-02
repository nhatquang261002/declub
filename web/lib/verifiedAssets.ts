import { getAddress, isAddress, type Address } from "viem";
import { CHAIN_ID } from "./config";
import { DEMO_ASSETS } from "./demoClubs";
import raw from "../data/assets.json" with { type: "json" };

/**
 * The curated list of verified and blocked assets (ADR 0014). It changes what the app shows and
 * which assets get a Club (ADR 0016), never what the contracts allow. One file, reviewed by pull
 * request, bundled into the build.
 *
 * Verified isn't the same as having a community: only NFT collections and memecoins get a Club. A
 * stablecoin or wrapped MON is verified so its deals are trusted, and has no Club.
 */
export type AssetStatus = "verified" | "blocked";
/** What an ERC-20 is for. Only a memecoin gets a Club. */
export type TokenCategory = "memecoin" | "stablecoin" | "wrapped" | "other";
/**
 * `false` lists an asset as verified without a Club; `"archived"` keeps a Club read-only. An
 * address puts the asset in that asset's Club instead of its own: a memecoin and the collection it
 * goes with (CHOG and the Chogs) share one Club.
 */
export type ClubSetting = boolean | "archived" | Address;

export type AssetEntry = {
  chainId: number;
  /** Checksummed. */
  address: Address;
  kind: "erc721" | "erc20";
  /** ERC-20 only, and required for one. */
  category?: TokenCategory;
  name: string;
  symbol: string;
  status: AssetStatus;
  /** Why it's on the list. Required: a bare "verified" says nothing. */
  note: string;
  /** Club setting; absent means a verified collection or memecoin has a Club. */
  club?: ClubSetting;
  /** ERC-20 only: the smallest balance (base units, as a decimal string) that earns the Holder badge. */
  minHolding?: string;
  /** The Club's art: a file the app ships under `web/public`, e.g. "/art/chogs/chog-01.png". */
  image?: string;
};

/** What a screen can say about an address: on the list, or not on it at all. */
export type AssetTier = AssetStatus | "unverified";

const STATUS = new Set(["verified", "blocked"]);
/** A path inside the app's own `public/` folder, never a URL: the list can't make the app load from elsewhere. */
const IMAGE = /^\/(?:[\w-]+\/)*[\w-]+\.(?:png|jpe?g|webp|svg)$/;
const KIND = new Set(["erc721", "erc20"]);
const CATEGORY = new Set<string>(["memecoin", "stablecoin", "wrapped", "other"]);

/** A collection or a memecoin: the assets that can have a community. */
export const isCommunityAsset = (e: Pick<AssetEntry, "kind" | "category">) => e.kind === "erc721" || e.category === "memecoin";

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
    if (e.kind === "erc20" && (typeof e.category !== "string" || !CATEGORY.has(e.category))) {
      throw new Error(`${at}: an erc20 needs a category: memecoin, stablecoin, wrapped or other`);
    }
    if (e.kind === "erc721" && e.category !== undefined) throw new Error(`${at}: category is only for erc20`);
    if (e.club !== undefined && typeof e.club !== "boolean" && e.club !== "archived") {
      if (typeof e.club !== "string" || !isAddress(e.club, { strict: false })) {
        throw new Error(`${at}: club must be true, false, "archived" or the address of the Club to join`);
      }
      if (e.club !== getAddress(e.club)) throw new Error(`${at}: club address must be checksummed (${getAddress(e.club)})`);
    }
    if (e.club !== undefined && e.club !== false && !isCommunityAsset(e as Pick<AssetEntry, "kind" | "category">)) {
      throw new Error(`${at}: only NFT collections and memecoins have a Club; leave club out or set it to false`);
    }
    if (e.minHolding !== undefined) {
      if (e.kind !== "erc20") throw new Error(`${at}: minHolding is only for erc20`);
      if (typeof e.minHolding !== "string" || !/^[1-9][0-9]*$/.test(e.minHolding)) {
        throw new Error(`${at}: minHolding must be a positive integer string`);
      }
    }
    if (e.image !== undefined && (typeof e.image !== "string" || !IMAGE.test(e.image))) {
      throw new Error(`${at}: image must be a path under public/, like "/art/name.png"`);
    }
    const key = `${e.chainId}:${address}`;
    if (seen.has(key)) throw new Error(`${at}: ${address} is listed twice on chain ${e.chainId}`);
    seen.add(key);
    return item as AssetEntry;
  });
}

/**
 * A Club as the registry hands it out: the entry of its own asset, which keys everything the Club
 * stores, and the asset that joined it (a memecoin in a collection's Club, or the other way round).
 */
export type ClubEntry = AssetEntry & { linked?: AssetEntry };

/** Every asset of a Club, its own first. */
export const clubAssets = (club: ClubEntry): AssetEntry[] => (club.linked ? [club, club.linked] : [club]);

export type Registry = {
  tier(token: string, chainId?: number): AssetTier;
  /** The entry for `token`, when it is on the list. */
  entry(token: string, chainId?: number): AssetEntry | null;
  /** The Club `token` belongs to, on this chain: its own, or the one it joined. */
  clubFor(token: string, chainId?: number): ClubEntry | null;
  /** Every Club on the chain, archived ones included. An asset in another's Club isn't one. */
  clubs(chainId?: number): ClubEntry[];
};

const keyOf = (chainId: number, token: string) => `${chainId}:${token.toLowerCase()}`;

/**
 * Matched by chain id and address, never by name or symbol (ADR 0014). Throws when one asset's
 * `club` names another that can't take it, so a bad pairing fails the build like a bad entry.
 */
export function makeRegistry(entries: AssetEntry[]): Registry {
  const byKey = new Map(entries.map((e) => [keyOf(e.chainId, e.address), e]));
  const entry = (token: string, chainId = CHAIN_ID) => byKey.get(keyOf(chainId, token)) ?? null;
  const live = (e: AssetEntry) => e.status === "verified" && e.club !== false && isCommunityAsset(e);
  const joins = (e: AssetEntry) => typeof e.club === "string" && e.club.startsWith("0x");

  // A Club takes one asset of the other kind: a collection and its memecoin, never a chain of them.
  const linked = new Map<string, AssetEntry>();
  for (const e of entries.filter((e) => live(e) && joins(e))) {
    const home = byKey.get(keyOf(e.chainId, e.club as string));
    const at = `${e.symbol} (${e.address})`;
    if (!home || !live(home) || joins(home)) throw new Error(`${at}: club names ${e.club as string}, which has no Club of its own on chain ${e.chainId}`);
    if (home.kind === e.kind) throw new Error(`${at}: a Club pairs a collection with a memecoin, not two of a kind`);
    const key = keyOf(home.chainId, home.address);
    if (linked.has(key)) throw new Error(`${at}: ${home.symbol}'s Club already has ${linked.get(key)!.symbol}`);
    linked.set(key, e);
  }
  const asClub = (home: AssetEntry): ClubEntry => {
    const other = linked.get(keyOf(home.chainId, home.address));
    return other ? { ...home, linked: other } : home;
  };

  const clubs = new Map<string, ClubEntry>();
  for (const e of entries) if (live(e) && !joins(e)) clubs.set(keyOf(e.chainId, e.address), asClub(e));

  return {
    entry,
    tier: (token, chainId) => entry(token, chainId)?.status ?? "unverified",
    clubFor(token, chainId) {
      const found = entry(token, chainId);
      if (!found || !live(found)) return null;
      return clubs.get(joins(found) ? keyOf(found.chainId, found.club as string) : keyOf(found.chainId, found.address)) ?? null;
    },
    clubs: (chainId = CHAIN_ID) => [...clubs.values()].filter((e) => e.chainId === chainId),
  };
}

export const ASSETS = parseAssets(raw);
/** The list plus, in development, the mock Clubs (lib/demoClubs.ts), so screens can be tried with many. */
export const registry = makeRegistry([...ASSETS, ...DEMO_ASSETS]);
