import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ASSETS, makeRegistry, parseAssets, registry, type AssetEntry } from "../lib/verifiedAssets";

const A = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const B = "0xd300f095f456D59AAc122B0100833fE195136F6c";
const entry = (over: Record<string, unknown> = {}) => ({
  chainId: 10143,
  address: A,
  kind: "erc721",
  name: "Mock Chog",
  symbol: "MCHOG",
  status: "verified",
  note: "Why it is listed.",
  ...over,
});

describe("assets.json", () => {
  it("parses as shipped", () => {
    const fromDisk = JSON.parse(readFileSync(new URL("../data/assets.json", import.meta.url), "utf8"));
    assert.equal(parseAssets(fromDisk).length, ASSETS.length);
    assert.ok(ASSETS.length > 0);
  });

  it("accepts a minimal entry and the optional fields", () => {
    assert.equal(parseAssets([entry()]).length, 1);
    assert.equal(parseAssets([entry({ club: "archived" }), entry({ address: B, kind: "erc20", category: "memecoin", minHolding: "5" })]).length, 2);
    assert.equal(parseAssets([entry({ image: "/art/chogs/chog-01.png" })]).length, 1);
  });

  it("rejects what would mislead", () => {
    const bad: [string, unknown][] = [
      ["not an array", {}],
      ["lowercase address", [entry({ address: A.toLowerCase() })]],
      ["not an address", [entry({ address: "0x1234" })]],
      ["unknown kind", [entry({ kind: "erc1155" })]],
      ["unknown status", [entry({ status: "trusted" })]],
      ["empty note", [entry({ note: "  " })]],
      ["empty name", [entry({ name: "" })]],
      ["bad club", [entry({ club: "yes" })]],
      ["remote image", [entry({ image: "https://example.com/a.png" })]],
      ["image outside public", [entry({ image: "/../secret.png" })]],
      ["image without an extension", [entry({ image: "/art/chog" })]],
      ["minHolding on an NFT", [entry({ minHolding: "1" })]],
      ["minHolding zero", [entry({ kind: "erc20", category: "memecoin", minHolding: "0" })]],
      ["duplicate on a chain", [entry(), entry()]],
      ["erc20 without a category", [entry({ kind: "erc20" })]],
      ["unknown category", [entry({ kind: "erc20", category: "governance" })]],
      ["category on an NFT", [entry({ category: "memecoin" })]],
      ["a Club for a stablecoin", [entry({ kind: "erc20", category: "stablecoin", club: true })]],
      ["an archived Club for wrapped MON", [entry({ kind: "erc20", category: "wrapped", club: "archived" })]],
      ["a Club address in lowercase", [entry({ address: B, kind: "erc20", category: "memecoin", club: A.toLowerCase() })]],
    ];
    for (const [name, list] of bad) assert.throws(() => parseAssets(list), Error, name);
  });

  it("allows the same address on two chains", () => {
    assert.equal(parseAssets([entry(), entry({ chainId: 143 })]).length, 2);
  });
});

describe("registry", () => {
  const list: AssetEntry[] = parseAssets([
    entry(),
    entry({ address: B, kind: "erc20", category: "stablecoin", symbol: "mUSD" }),
    entry({ address: "0x73591F76d7deE66F683A979cEffb4356982EE1bB", status: "blocked", note: "Scam clone." }),
    entry({ chainId: 143, address: "0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298", club: "archived" }),
  ]);
  const r = makeRegistry(list);

  it("matches by chain and address, in any case", () => {
    assert.equal(r.tier(A.toLowerCase(), 10143), "verified");
    assert.equal(r.tier(A.toUpperCase().replace("0X", "0x"), 10143), "verified");
    assert.equal(r.tier(A, 143), "unverified");
    assert.equal(r.tier("0x0000000000000000000000000000000000000001", 10143), "unverified");
  });

  it("gives a Club to verified entries only, unless club is false", () => {
    assert.equal(r.clubFor(A, 10143)?.symbol, "MCHOG");
    assert.equal(r.clubFor(B, 10143), null);
    assert.equal(r.tier(B, 10143), "verified");
    assert.equal(r.clubFor("0x73591F76d7deE66F683A979cEffb4356982EE1bB", 10143), null);
    assert.equal(r.tier("0x73591F76d7deE66F683A979cEffb4356982EE1bB", 10143), "blocked");
  });

  it("keeps an archived Club listed", () => {
    assert.equal(r.clubFor("0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298", 143)?.club, "archived");
    assert.deepEqual(r.clubs(143).map((e) => e.address), ["0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298"]);
  });

  it("lists a chain's Clubs", () => {
    assert.deepEqual(r.clubs(10143).map((e) => e.address), [A]);
  });

  it("ships a Club for the project's own test collection", () => {
    assert.ok(registry.clubFor(A, 10143));
  });

  it("gives collections and memecoins a Club, and no other token", () => {
    const tokens = makeRegistry(
      parseAssets(
        (["memecoin", "stablecoin", "wrapped", "other"] as const).map((category, i) =>
          entry({ address: `0x${String(i + 1).padStart(40, "0")}`, kind: "erc20", category, symbol: category }),
        ),
      ),
    );
    assert.deepEqual(tokens.clubs(10143).map((e) => e.symbol), ["memecoin"]);
    assert.equal(tokens.tier(`0x${"2".padStart(40, "0")}`, 10143), "verified");
  });
});

describe("paired Clubs", () => {
  const C = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
  const coin = (over: Record<string, unknown> = {}) => entry({ address: B, kind: "erc20", category: "memecoin", symbol: "CHOG", club: A, ...over });

  it("puts a memecoin in its collection's Club", () => {
    const r = makeRegistry(parseAssets([entry(), coin()]));
    assert.deepEqual(r.clubs(10143).map((e) => e.address), [A], "one Club, not two");
    assert.equal(r.clubFor(B, 10143)?.address, A, "the coin's address finds the collection's Club");
    assert.equal(r.clubFor(A, 10143)?.linked?.symbol, "CHOG");
    assert.equal(r.clubFor(B.toLowerCase(), 10143)?.linked?.address, B);
  });

  it("works the other way round: a collection in its memecoin's Club", () => {
    const r = makeRegistry(parseAssets([entry({ club: B }), coin({ club: undefined })]));
    assert.deepEqual(r.clubs(10143).map((e) => e.symbol), ["CHOG"]);
    assert.equal(r.clubFor(A, 10143)?.symbol, "CHOG");
  });

  it("keeps the collection's archive setting for both", () => {
    const r = makeRegistry(parseAssets([entry({ club: "archived" }), coin()]));
    assert.equal(r.clubFor(B, 10143)?.club, "archived");
  });

  it("drops a blocked asset from the pairing without breaking the Club", () => {
    const r = makeRegistry(parseAssets([entry(), coin({ status: "blocked" })]));
    assert.equal(r.clubFor(A, 10143)?.linked, undefined);
    assert.equal(r.clubFor(B, 10143), null);
  });

  it("refuses a pairing that can't work", () => {
    const third = entry({ address: C, kind: "erc20", category: "memecoin", symbol: "PURP", club: A });
    const bad: [string, AssetEntry[]][] = [
      ["a Club that isn't listed", parseAssets([coin()])],
      ["a Club switched off", parseAssets([entry({ club: false }), coin()])],
      ["a Club with no community", parseAssets([entry({ address: C, kind: "erc20", category: "stablecoin", symbol: "USD" }), coin({ club: C })])],
      ["two of a kind", parseAssets([entry(), entry({ address: C, symbol: "MORE", club: A })])],
      ["a second asset", parseAssets([entry(), coin(), third])],
      ["a chain of Clubs", parseAssets([entry(), coin(), entry({ address: C, symbol: "PET", club: B })])],
      ["another chain's Club", parseAssets([entry({ chainId: 143 }), coin()])],
    ];
    for (const [name, list] of bad) assert.throws(() => makeRegistry(list), Error, name);
  });
});
