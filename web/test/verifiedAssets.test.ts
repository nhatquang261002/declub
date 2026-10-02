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
    assert.equal(parseAssets([entry({ club: "archived" }), entry({ address: B, kind: "erc20", minHolding: "5" })]).length, 2);
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
      ["minHolding on an NFT", [entry({ minHolding: "1" })]],
      ["minHolding zero", [entry({ kind: "erc20", minHolding: "0" })]],
      ["duplicate on a chain", [entry(), entry()]],
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
    entry({ address: B, kind: "erc20", symbol: "mUSD", club: false }),
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
});
