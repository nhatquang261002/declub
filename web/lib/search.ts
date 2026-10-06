import { getAddress, isAddress, type Address } from "viem";
import { safeImage } from "./collections";

/**
 * On-chain asset search (ADR 0027). One result shape for tokens and NFT collections, whichever
 * source found them (a data provider, the chain itself, the verified list, or what this browser
 * already knows), and one ranking: what the wallet holds first, then verified assets, then the rest.
 *
 * Nothing here is trusted. A provider can return any name for any address, so a hit is only a
 * pointer: whatever is picked is read again from its contract, and the address always stays visible.
 */
export type SearchKind = "erc20" | "erc721";

export type SearchHit = {
  kind: SearchKind;
  /** Checksummed. */
  address: Address;
  name: string;
  symbol: string;
  logo: string | null;
  /** From the curated list only (ADR 0014): no provider can make an asset "verified". */
  tier: "verified" | "unverified";
  /** The searching wallet holds some. */
  held: boolean;
  /** ERC-20: the wallet's balance in base units, as a decimal string. */
  balance?: string;
  decimals?: number;
  /** ERC-721: how many of the collection's tokens the wallet holds. */
  count?: number;
  /** USD value of the holding, when the provider prices it. Only used to order holdings. */
  usd?: number;
  /** Flagged as spam by the provider. Shown last, with a warning. */
  spam: boolean;
  /** Where the app already knew it from ("Featured", "Recent", "In open deals"). */
  tag?: string;
};

export const MAX_QUERY = 100;
const NAME_MAX = 48;
const SYMBOL_MAX = 16;

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";

const keyOf = (hit: Pick<SearchHit, "kind" | "address">) => `${hit.kind}:${hit.address.toLowerCase()}`;

// ─────────────────────────────────────────────────────────────── Ranking

/** How well `hit` matches the query: 0 best, null = not a match. An empty query matches everything. */
export function matchQuality(hit: Pick<SearchHit, "name" | "symbol" | "address">, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = hit.name.toLowerCase();
  const symbol = hit.symbol.toLowerCase();
  const address = hit.address.toLowerCase();
  if (address === q || symbol === q || name === q) return 0;
  if (symbol.startsWith(q) || name.startsWith(q)) return 1;
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if (symbol.includes(q) || name.includes(q) || (q.startsWith("0x") && address.includes(q))) return 3;
  return null;
}

/** 0 held, 1 verified, 2 everything else, 3 flagged as spam. */
const group = (hit: SearchHit) => (hit.spam ? 3 : hit.held ? 0 : hit.tier === "verified" ? 1 : 2);

/** The hits that match `query`, best first: holdings, then verified, then the rest; closer matches first within each. */
export function rankHits(hits: readonly SearchHit[], query: string): SearchHit[] {
  return hits
    .flatMap((hit) => {
      const quality = matchQuality(hit, query);
      return quality === null ? [] : [{ hit, quality }];
    })
    .sort(
      (a, b) =>
        group(a.hit) - group(b.hit) ||
        a.quality - b.quality ||
        (b.hit.usd ?? 0) - (a.hit.usd ?? 0) ||
        a.hit.name.localeCompare(b.hit.name),
    )
    .map((row) => row.hit);
}

/** One hit per asset. Later lists fill in what earlier ones lack; `held` and `spam` stick once set. */
export function mergeHits(...lists: readonly (readonly SearchHit[])[]): SearchHit[] {
  const out = new Map<string, SearchHit>();
  for (const hit of lists.flat()) {
    const known = out.get(keyOf(hit));
    if (!known) {
      out.set(keyOf(hit), hit);
      continue;
    }
    out.set(keyOf(hit), {
      ...known,
      name: known.name || hit.name,
      symbol: known.symbol || hit.symbol,
      logo: known.logo ?? hit.logo,
      tier: known.tier === "verified" || hit.tier === "verified" ? "verified" : "unverified",
      held: known.held || hit.held,
      balance: known.balance ?? hit.balance,
      decimals: known.decimals ?? hit.decimals,
      count: known.count ?? hit.count,
      usd: known.usd ?? hit.usd,
      spam: known.spam || hit.spam,
      tag: known.tag ?? hit.tag,
    });
  }
  return [...out.values()];
}

// ─────────────────────────────────────────────────────────────── Provider responses

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const rows = (json: unknown): Record<string, unknown>[] => {
  const result = record(json)?.result;
  return Array.isArray(result) ? result.flatMap((row): Record<string, unknown>[] => { const r = record(row); return r ? [r] : []; }) : [];
};

const addressOf = (value: unknown): Address | null => (typeof value === "string" && isAddress(value, { strict: false }) ? getAddress(value) : null);

const base = (kind: SearchKind, address: Address, row: Record<string, unknown>): SearchHit => ({
  kind,
  address,
  name: text(row.name, NAME_MAX),
  symbol: text(row.symbol, SYMBOL_MAX),
  logo: null,
  tier: "unverified",
  held: false,
  spam: row.possible_spam === true,
});

/** Moralis `GET /wallets/{address}/tokens`: the wallet's ERC-20s. Native MON is left out (it has its own button). */
export function parseWalletTokens(json: unknown): SearchHit[] {
  return rows(json).flatMap((row) => {
    const address = addressOf(row.token_address);
    if (!address || row.native_token === true) return [];
    const balance = typeof row.balance === "string" && /^\d+$/.test(row.balance) ? row.balance : undefined;
    if (!balance || BigInt(balance) === 0n) return [];
    const decimals = Number(row.decimals);
    const usd = Number(row.usd_value);
    return [
      {
        ...base("erc20", address, row),
        logo: safeImage(typeof row.logo === "string" ? row.logo : null),
        held: true,
        balance,
        decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : undefined,
        usd: Number.isFinite(usd) ? usd : undefined,
      },
    ];
  });
}

/** Moralis `GET /{address}/nft/collections`: the collections a wallet holds, with how many tokens. */
export function parseWalletCollections(json: unknown): SearchHit[] {
  return rows(json).flatMap((row) => {
    const address = addressOf(row.token_address);
    if (!address) return [];
    const count = Number(row.count);
    if (!Number.isFinite(count) || count < 1) return [];
    return [
      {
        ...base("erc721", address, row),
        logo: safeImage(typeof row.collection_logo === "string" ? row.collection_logo : null),
        held: true,
        count: Math.floor(count),
      },
    ];
  });
}

/** Moralis `GET /tokens/search`: tokens by name, symbol or address. */
export function parseTokenSearch(json: unknown): SearchHit[] {
  return rows(json).flatMap((row) => {
    const address = addressOf(row.tokenAddress);
    return address ? [{ ...base("erc20", address, row), logo: safeImage(typeof row.logo === "string" ? row.logo : null) }] : [];
  });
}
