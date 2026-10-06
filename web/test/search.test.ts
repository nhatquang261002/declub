import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address } from "viem";
import { matchQuality, mergeHits, parseTokenSearch, parseWalletCollections, parseWalletTokens, rankHits, type SearchHit } from "../lib/search";
import { moralisProvider, runSearch, type ChainReader, type Provider, type SearchDeps } from "../lib/server/chainSearch";
import type { AssetEntry } from "../lib/verifiedAssets";

const A = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4" as Address;
const B = "0xd300f095f456D59AAc122B0100833fE195136F6c" as Address;
const C = "0x32A325b0640594377D0708Ca9081c93da95e1908" as Address;
const D = "0x1111111111111111111111111111111111111111" as Address;
const E = "0x3333333333333333333333333333333333333333" as Address;
const OWNER = "0x2222222222222222222222222222222222222222" as Address;

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  kind: "erc20",
  address: D,
  name: "Token",
  symbol: "TKN",
  logo: null,
  tier: "unverified",
  held: false,
  spam: false,
  ...over,
});

describe("matchQuality", () => {
  it("ranks exact, prefix, word and substring matches, and rejects the rest", () => {
    const h = hit({ name: "Mock Chog", symbol: "MCHOG" });
    assert.equal(matchQuality(h, ""), 0);
    assert.equal(matchQuality(h, "mchog"), 0);
    assert.equal(matchQuality(h, "mock chog"), 0);
    assert.equal(matchQuality(h, "mo"), 1);
    assert.equal(matchQuality(h, "ch"), 2);
    assert.equal(matchQuality(h, "hog"), 3);
    assert.equal(matchQuality(h, "zzz"), null);
  });

  it("matches an address, whole or in part", () => {
    const h = hit({ address: A });
    assert.equal(matchQuality(h, A.toLowerCase()), 0);
    assert.equal(matchQuality(h, A.slice(0, 8)), 3);
  });
});

describe("rankHits", () => {
  it("puts holdings before verified assets before the rest, whatever the match", () => {
    const rest = hit({ address: A, name: "Chog", symbol: "CHOG" });
    const verified = hit({ address: B, name: "Chog Verified", symbol: "CHOGV", tier: "verified" });
    const held = hit({ address: C, name: "Some Chog Fan", symbol: "FAN", held: true });
    const out = rankHits([rest, verified, held], "chog");
    assert.deepEqual(out.map((h) => h.address), [C, B, A]);
  });

  it("orders holdings by value, then count, and spam last", () => {
    const small = hit({ address: A, held: true, usd: 5 });
    const big = hit({ address: B, held: true, usd: 500 });
    const spam = hit({ address: C, held: true, spam: true, usd: 9999 });
    assert.deepEqual(rankHits([spam, small, big], "").map((h) => h.address), [B, A, C]);
  });

  it("orders by closeness within a group", () => {
    const exact = hit({ address: A, name: "Alpha", symbol: "ABC" });
    const partial = hit({ address: B, name: "Zabc coin", symbol: "ZZZ" });
    assert.deepEqual(rankHits([partial, exact], "abc").map((h) => h.address), [A, B]);
  });

  it("drops what doesn't match", () => {
    assert.deepEqual(rankHits([hit({ name: "Alpha", symbol: "ALP" })], "beta"), []);
  });
});

describe("mergeHits", () => {
  it("keeps one hit per asset and lets holdings and verification stick", () => {
    const [one] = mergeHits([hit({ address: A, name: "" })], [hit({ address: A, name: "Named", held: true, balance: "5" })], [hit({ address: A, tier: "verified" })]);
    assert.equal(one.name, "Named");
    assert.equal(one.held, true);
    assert.equal(one.tier, "verified");
    assert.equal(one.balance, "5");
  });

  it("keeps an ERC-20 and an NFT with the same address apart", () => {
    assert.equal(mergeHits([hit({ address: A })], [hit({ address: A, kind: "erc721" })]).length, 2);
  });
});

describe("provider responses", () => {
  it("reads a wallet's tokens, leaving out native MON, empty balances and bad rows", () => {
    const out = parseWalletTokens({
      result: [
        { token_address: A.toLowerCase(), symbol: "MUSD", name: "Mock USD", decimals: "18", balance: "1500000000000000000", usd_value: 1.5, logo: "https://x.test/a.png" },
        { token_address: B, symbol: "MON", name: "Monad", balance: "5", native_token: true },
        { token_address: C, symbol: "ZERO", name: "Zero", balance: "0" },
        { token_address: "nope", symbol: "BAD", balance: "1" },
        "junk",
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].address, A);
    assert.equal(out[0].held, true);
    assert.equal(out[0].decimals, 18);
    assert.equal(out[0].usd, 1.5);
    assert.equal(out[0].logo, "https://x.test/a.png");
    assert.equal(out[0].tier, "unverified");
  });

  it("never lets a provider mark an asset verified, and drops unsafe logos and control characters", () => {
    const [t] = parseWalletTokens({
      result: [{ token_address: A, symbol: "S\u0000YM", name: "N".repeat(200), balance: "1", verified_contract: true, logo: "javascript:alert(1)" }],
    });
    assert.equal(t.tier, "unverified");
    assert.equal(t.logo, null);
    assert.equal(t.symbol, "SYM");
    assert.equal(t.name.length, 48);
  });

  it("reads a wallet's collections with counts and the spam flag", () => {
    const out = parseWalletCollections({
      result: [
        { token_address: A, name: "Chogs", symbol: "CHOG", count: "3", collection_logo: "https://x.test/c.png" },
        { token_address: B, name: "Spam", symbol: "SP", count: 1, possible_spam: true },
        { token_address: C, name: "None", count: 0 },
      ],
    });
    assert.deepEqual(out.map((h) => [h.address, h.count, h.spam]), [[A, 3, false], [B, 1, true]]);
  });

  it("reads token search results", () => {
    const out = parseTokenSearch({ total: 1, result: [{ tokenAddress: A, name: "Mock", symbol: "MCK", logo: null }] });
    assert.equal(out[0].kind, "erc20");
    assert.equal(out[0].held, false);
  });

  it("copes with a malformed body", () => {
    assert.deepEqual(parseWalletTokens(null), []);
    assert.deepEqual(parseWalletCollections({ result: "x" }), []);
    assert.deepEqual(parseTokenSearch([]), []);
  });
});

describe("moralisProvider", () => {
  it("is off without a key or on a chain Moralis doesn't cover", () => {
    assert.equal(moralisProvider("", 143), null);
    assert.equal(moralisProvider("key", 10143), null);
    assert.ok(moralisProvider("key", 143));
  });

  it("calls Monad mainnet with the key in a header and the wallet in the path", async () => {
    const calls: { url: string; key: string | null }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, key: new Headers(init?.headers).get("x-api-key") });
      return new Response(JSON.stringify({ result: [] }));
    }) as unknown as typeof fetch;
    const provider = moralisProvider("secret", 143, fake)!;
    await provider.walletTokens(OWNER);
    await provider.walletCollections(OWNER);
    await provider.searchTokens("chog");
    assert.ok(calls[0].url.includes(`/wallets/${OWNER}/tokens`) && calls[0].url.includes("chain=0x8f"));
    assert.ok(calls[1].url.includes(`/${OWNER}/nft/collections`));
    assert.ok(calls[2].url.includes("/tokens/search") && calls[2].url.includes("query=chog"));
    assert.ok(calls.every((c) => c.key === "secret" && !c.url.includes("secret")));
  });

  it("throws on an error status, so the search can fall back to the chain", async () => {
    const fake = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(moralisProvider("k", 143, fake)!.walletTokens(OWNER));
  });
});

// ─────────────────────────────────────────────────────────────── The search

const entry = (over: Partial<AssetEntry>): AssetEntry => ({
  chainId: 10143,
  address: A,
  kind: "erc721",
  name: "Mock Chog",
  symbol: "MCHOG",
  status: "verified",
  note: "test",
  ...over,
});

/** A chain where `owner` holds 3 of A and 7 mUSD (B); C is a featured collection the list doesn't know. */
const reader = (balances: Record<string, bigint> = { [A.toLowerCase()]: 3n, [B.toLowerCase()]: 7n }): ChainReader => ({
  balances: async (_owner, tokens) => tokens.map((t) => balances[t.toLowerCase()] ?? 0n),
  labels: async (tokens) => tokens.map((t) => (t === C ? { name: "Chog Genesis", symbol: "CHOG", decimals: null } : { name: null, symbol: null, decimals: null })),
});

const deps = (over: Partial<SearchDeps> = {}): SearchDeps => ({
  provider: null,
  reader: reader(),
  chainId: 10143,
  assets: [entry({}), entry({ address: B, kind: "erc20", name: "Mock USD", symbol: "mUSD", category: "stablecoin" }), entry({ address: D, kind: "erc20", name: "Scam", symbol: "SCAM", status: "blocked" })],
  featured: [C],
  ...over,
});

const params = { kind: "any", scope: "all", query: "" } as const;
// The cache is shared, so each test uses its own wallet.
const wallet = (n: number) => `0x${String(n).padStart(40, "0")}` as Address;

describe("runSearch on the chain alone", () => {
  it("lists what the wallet holds first, then verified assets, then featured ones", async () => {
    const r = await runSearch({ ...params, owner: wallet(1) }, deps());
    assert.equal(r.source, "chain");
    assert.deepEqual(r.hits.map((h) => h.address), [A, B, C]);
    assert.equal(r.hits[0].count, 3);
    assert.equal(r.hits[1].balance, "7");
    assert.ok(r.hits[0].held && r.hits[1].held && !r.hits[2].held);
  });

  it("never returns a blocked asset, even when the wallet holds it", async () => {
    const r = await runSearch({ ...params, owner: wallet(2) }, deps({ reader: reader({ [D.toLowerCase()]: 9n }) }));
    assert.ok(!r.hits.some((h) => h.address === D));
  });

  it("limits to holdings when asked", async () => {
    const r = await runSearch({ ...params, scope: "holdings", owner: wallet(3) }, deps());
    assert.deepEqual(r.hits.map((h) => h.address), [A, B]);
  });

  it("filters by kind and by the query", async () => {
    const tokens = await runSearch({ ...params, kind: "erc20", owner: wallet(4) }, deps());
    assert.deepEqual(tokens.hits.map((h) => h.address), [B]);
    const named = await runSearch({ ...params, query: "genesis", owner: wallet(4) }, deps());
    assert.deepEqual(named.hits.map((h) => h.address), [C]);
  });

  it("marks listed assets verified and the rest not", async () => {
    const r = await runSearch({ ...params }, deps({ chainId: 10143 }));
    assert.deepEqual(Object.fromEntries(r.hits.map((h) => [h.address, h.tier])), { [A]: "verified", [B]: "verified", [C]: "unverified" });
  });

  it("has no holdings without a wallet", async () => {
    const r = await runSearch({ ...params, scope: "holdings" }, deps());
    assert.ok(r.hits.every((h) => !h.held));
  });
});

describe("runSearch with a provider", () => {
  const provider = (over: Partial<Provider> = {}): Provider => ({
    walletTokens: async () => [hit({ address: E, name: "Pepe Monad", symbol: "PEPE", held: true, balance: "100", decimals: 18, usd: 40 })],
    walletCollections: async () => [hit({ kind: "erc721", address: C, name: "Chog Genesis", symbol: "CHOG", held: true, count: 2 })],
    searchTokens: async (q) => [hit({ address: wallet(99), name: `Result for ${q}`, symbol: "RES" })],
    ...over,
  });

  it("ranks what the wallet holds above search results", async () => {
    const r = await runSearch({ ...params, query: "e", owner: wallet(10) }, deps({ provider: provider() }));
    assert.equal(r.source, "moralis");
    assert.equal(r.degraded, false);
    assert.deepEqual(r.hits.slice(0, 2).map((h) => h.address), [E, C]);
    assert.ok(r.hits.some((h) => h.name === "Result for e" && !h.held));
  });

  it("searches only the holdings when asked, without spending a provider search", async () => {
    let searched = false;
    const r = await runSearch({ ...params, scope: "holdings", owner: wallet(11) }, deps({ provider: provider({ searchTokens: async () => ((searched = true), []) }) }));
    assert.equal(searched, false);
    assert.ok(r.hits.every((h) => h.held));
  });

  it("falls back to the chain when the provider fails, and says so", async () => {
    const down = provider({ walletTokens: async () => { throw new Error("401"); }, searchTokens: async () => { throw new Error("401"); } });
    const r = await runSearch({ ...params, owner: wallet(12) }, deps({ provider: down }));
    assert.equal(r.degraded, true);
    assert.ok(r.hits.some((h) => h.address === A && h.held), "the chain still finds the verified collection held");
    assert.ok(r.hits.some((h) => h.address === C && h.held), "the collections the provider did answer are kept");
  });

  it("doesn't send an address to the token search", async () => {
    let searched = false;
    await runSearch({ ...params, query: A, owner: wallet(13) }, deps({ provider: provider({ searchTokens: async () => ((searched = true), []) }) }));
    assert.equal(searched, false);
  });

  it("drops a blocked asset the provider returns", async () => {
    const blocked = provider({ searchTokens: async () => [hit({ address: D, name: "Scam", symbol: "SCAM" })] });
    const r = await runSearch({ ...params, query: "scam", owner: wallet(14) }, deps({ provider: blocked }));
    assert.ok(!r.hits.some((h) => h.address === D));
  });
});
