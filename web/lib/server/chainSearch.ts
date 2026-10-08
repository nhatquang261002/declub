import { createPublicClient, erc20Abi, http, parseAbi, type Address, type PublicClient } from "viem";
import { chain } from "../chain";
import { CHAIN_ID, RPC_URL } from "../config";
import { featuredCollections } from "../collections";
import { MAX_QUERY, mergeHits, parseTokenSearch, parseWalletCollections, parseWalletTokens, rankHits, type SearchHit, type SearchKind } from "../search";
import { ASSETS, makeRegistry, type AssetEntry } from "../verifiedAssets";

/**
 * On-chain asset search (ADR 0027). The public RPC can't search by name or list what a wallet
 * holds, so a data provider (Moralis) answers where it covers the chain. Where it doesn't (Monad
 * testnet), or when it fails, the chain answers for the assets the app already knows: the verified
 * list and the featured collections, with the wallet's balances read from the contracts.
 *
 * The provider key stays on the server, and a hit is only a pointer: the client reads whatever it
 * picks from the contract again.
 */

type SearchParams = {
  query: string;
  /** The wallet whose holdings come first. */
  owner?: Address;
  kind: SearchKind | "any";
  /** "holdings" lists only what `owner` holds; "all" searches everything, holdings first. */
  scope: "holdings" | "all";
  limit?: number;
};

type SearchResult = {
  hits: SearchHit[];
  /** Who answered: the provider, or the chain alone. */
  source: "moralis" | "chain";
  /** The provider was meant to answer and didn't, so the chain did. */
  degraded: boolean;
};

/** What a data provider can answer. */
export type Provider = {
  walletTokens(owner: Address): Promise<SearchHit[]>;
  walletCollections(owner: Address): Promise<SearchHit[]>;
  searchTokens(query: string): Promise<SearchHit[]>;
};

/** What the chain itself can answer, for the assets the app knows. */
export type ChainReader = {
  /** `balanceOf(owner)` for each token; null where the contract doesn't answer. */
  balances(owner: Address, tokens: readonly Address[]): Promise<(bigint | null)[]>;
  /** name, symbol and decimals; null where the contract doesn't answer. */
  labels(tokens: readonly Address[]): Promise<{ name: string | null; symbol: string | null; decimals: number | null }[]>;
};

export type SearchDeps = {
  provider: Provider | null;
  reader: ChainReader;
  chainId: number;
  /** The verified and blocked list (ADR 0014). */
  assets: readonly AssetEntry[];
  /** Collections the app features, read by the chain-only path. */
  featured: readonly Address[];
};

// ─────────────────────────────────────────────────────────────── Moralis

/** Chains Moralis covers, by chain id. Monad testnet isn't one of them. */
const MORALIS_CHAINS: Record<number, string> = { 143: "0x8f" };
const MORALIS_URL = "https://deep-index.moralis.io/api/v2.2";
const TIMEOUT_MS = 6000;

export function moralisProvider(apiKey: string, chainId: number, fetchImpl: typeof fetch = fetch): Provider | null {
  const chainParam = MORALIS_CHAINS[chainId];
  if (!apiKey || !chainParam) return null;
  const get = async (path: string, params: Record<string, string>): Promise<unknown> => {
    const url = `${MORALIS_URL}${path}?${new URLSearchParams(params)}`;
    const res = await fetchImpl(url, { headers: { "X-API-Key": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Moralis answered ${res.status}`);
    return res.json();
  };
  return {
    walletTokens: async (owner) =>
      parseWalletTokens(await get(`/wallets/${owner}/tokens`, { chain: chainParam, exclude_spam: "true", exclude_native: "true", limit: "100" })),
    walletCollections: async (owner) =>
      parseWalletCollections(await get(`/${owner}/nft/collections`, { chain: chainParam, token_counts: "true", exclude_spam: "true", limit: "100" })),
    searchTokens: async (query) => parseTokenSearch(await get("/tokens/search", { query, chains: chainParam, sortBy: "marketCapDesc", limit: "15" })),
  };
}

/** The provider this server is configured with, if any covers the chain. */
const configuredProvider = () => moralisProvider(process.env.MORALIS_API_KEY?.trim() ?? "", CHAIN_ID);

// ─────────────────────────────────────────────────────────────── The chain

const nameAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);

let cachedClient: PublicClient | undefined;
const client = () => (cachedClient ??= createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: true } }) as PublicClient);

const viemChainReader: ChainReader = {
  async balances(owner, tokens) {
    if (tokens.length === 0) return [];
    const results = await client().multicall({
      contracts: tokens.map((address) => ({ address, abi: nameAbi, functionName: "balanceOf", args: [owner] }) as const),
      allowFailure: true,
    });
    return results.map((r) => (r.status === "success" ? (r.result as bigint) : null));
  },
  async labels(tokens) {
    if (tokens.length === 0) return [];
    const results = await client().multicall({
      contracts: tokens.flatMap(
        (address) =>
          [
            { address, abi: nameAbi, functionName: "name" },
            { address, abi: nameAbi, functionName: "symbol" },
            { address, abi: erc20Abi, functionName: "decimals" },
          ] as const,
      ),
      allowFailure: true,
    });
    return tokens.map((_, i) => {
      const [name, symbol, decimals] = [0, 1, 2].map((k) => results[i * 3 + k]);
      return {
        name: name?.status === "success" ? String(name.result).slice(0, 48) : null,
        symbol: symbol?.status === "success" ? String(symbol.result).slice(0, 16) : null,
        decimals: decimals?.status === "success" ? Number(decimals.result) : null,
      };
    });
  },
};

// ─────────────────────────────────────────────────────────────── Search

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: Promise<SearchHit[]> }>();

/** Shares one answer between callers for a short while, so typing doesn't spend provider credits per keystroke. */
function cached(key: string, load: () => Promise<SearchHit[]>): Promise<SearchHit[]> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = load();
  cache.set(key, { at: now, value });
  // A failure isn't kept, and the map can't grow without bound.
  value.catch(() => cache.get(key)?.value === value && cache.delete(key));
  if (cache.size > 500) for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
  return value;
}

const fromList = (e: AssetEntry): SearchHit => ({
  kind: e.kind,
  address: e.address,
  name: e.name,
  symbol: e.symbol,
  logo: null,
  tier: e.status === "verified" ? "verified" : "unverified",
  held: false,
  spam: false,
});

/** The assets the app knows without a provider: the verified list and the featured collections. */
async function knownAssets(deps: SearchDeps): Promise<SearchHit[]> {
  const listed = deps.assets.filter((e) => e.chainId === deps.chainId && e.status === "verified").map(fromList);
  const have = new Set(listed.map((h) => h.address.toLowerCase()));
  const extra = deps.featured.filter((a) => !have.has(a.toLowerCase()));
  const labels = await deps.reader.labels(extra);
  return [
    ...listed,
    ...extra.map((address, i): SearchHit => ({
      kind: "erc721",
      address,
      name: labels[i]?.name ?? "",
      symbol: labels[i]?.symbol ?? "",
      logo: null,
      tier: "unverified",
      held: false,
      spam: false,
      tag: "Featured",
    })),
  ];
}

/** Marks which of `known` the wallet holds, by reading `balanceOf` from each contract. */
async function chainHoldings(owner: Address, known: readonly SearchHit[], reader: ChainReader): Promise<SearchHit[]> {
  const balances = await reader.balances(
    owner,
    known.map((h) => h.address),
  );
  return known.flatMap((hit, i) => {
    const balance = balances[i];
    if (balance === null || balance === undefined || balance === 0n) return [];
    return [hit.kind === "erc721" ? { ...hit, held: true, count: Number(balance) } : { ...hit, held: true, balance: balance.toString() }];
  });
}

/** Re-tags each hit from the verified list, which is the only source of "verified" and of "blocked". */
function tiered(hits: readonly SearchHit[], assets: readonly AssetEntry[], chainId: number): SearchHit[] {
  const registry = makeRegistry(assets.filter((e) => e.chainId === chainId));
  return hits.flatMap((hit): SearchHit[] => {
    const entry = registry.entry(hit.address, chainId);
    if (entry?.status === "blocked") return [];
    return [{ ...hit, tier: entry ? "verified" : "unverified", name: hit.name || entry?.name || "", symbol: hit.symbol || entry?.symbol || "" }];
  });
}

export async function runSearch(params: SearchParams, deps: SearchDeps): Promise<SearchResult> {
  const query = params.query.trim().slice(0, MAX_QUERY);
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 50);
  const wants = (kind: SearchKind) => params.kind === "any" || params.kind === kind;
  let degraded = false;
  let usedProvider = false;

  const attempt = async <T>(load: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await load();
    } catch {
      degraded = true;
      return fallback;
    }
  };

  const known = await attempt(() => cached(`known:${deps.chainId}`, () => knownAssets(deps)), [] as SearchHit[]);

  let held: SearchHit[] = [];
  if (params.owner) {
    const owner = params.owner;
    if (deps.provider) {
      const provider = deps.provider;
      const [tokens, collections] = await Promise.all([
        wants("erc20") ? attempt(() => cached(`tokens:${owner}`, () => provider.walletTokens(owner)), null) : [],
        wants("erc721") ? attempt(() => cached(`collections:${owner}`, () => provider.walletCollections(owner)), null) : [],
      ]);
      usedProvider = true;
      held = [...(tokens ?? []), ...(collections ?? [])];
      // Whatever the provider failed to answer, the chain answers for the assets the app knows.
      if (tokens === null || collections === null) {
        held = mergeHits(held, await attempt(() => cached(`held:${owner}`, () => chainHoldings(owner, known, deps.reader)), []));
      }
    } else {
      held = await attempt(() => cached(`held:${owner}`, () => chainHoldings(owner, known, deps.reader)), []);
    }
  }
  let found: SearchHit[] = [];
  if (params.scope === "all") {
    const searched =
      deps.provider && query && wants("erc20") && !query.startsWith("0x")
        ? await attempt(() => cached(`search:${query.toLowerCase()}`, () => deps.provider!.searchTokens(query)), [])
        : [];
    if (searched.length > 0) usedProvider = true;
    found = [...known, ...searched];
  }

  const hits = rankHits(
    tiered(mergeHits(held, found), deps.assets, deps.chainId).filter((h) => wants(h.kind)),
    query,
  ).slice(0, limit);
  return { hits, source: usedProvider ? "moralis" : "chain", degraded };
}

/** The search as the route runs it: this server's provider, chain and lists. */
export const searchChain = (params: SearchParams) =>
  runSearch(params, { provider: configuredProvider(), reader: viemChainReader, chainId: CHAIN_ID, assets: ASSETS, featured: featuredCollections() });
