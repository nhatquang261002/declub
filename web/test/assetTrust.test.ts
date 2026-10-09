import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address } from "viem";
import { erc20Asset, nativeAsset, nftAsset, traitAsset } from "../lib/assets";
import { allVerified, blockedProblem, glyphKey, sideTrust, trustOf, type AssetTrust } from "../lib/assetTrust";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const CHAIN = 10143;
const CHOG = "0x32A325b0640594377D0708Ca9081c93da95e1908" as Address;
const USD = "0xd300f095f456D59AAc122B0100833fE195136F6c" as Address;
const SCAM = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4" as Address;
const OTHER = "0x00000000000000000000000000000000000000a1" as Address;

const registry = makeRegistry(
  parseAssets([
    { chainId: CHAIN, address: CHOG, kind: "erc721", name: "Chog Genesis", symbol: "CHOG", status: "verified", note: "Official." },
    { chainId: CHAIN, address: USD, kind: "erc20", category: "stablecoin", name: "Mock USD", symbol: "mUSD", status: "verified", note: "Official." },
    { chainId: CHAIN, address: SCAM, kind: "erc721", name: "Ch0g Genesls", symbol: "CH0G", status: "blocked", note: "A copy." },
  ]),
);
const trust = (token: string, claimed: { name?: string; symbol?: string }) => trustOf(token, claimed, registry, CHAIN);

describe("glyphKey", () => {
  it("folds what a reader can't tell apart", () => {
    assert.equal(glyphKey("Chog Genesis"), glyphKey("CH0G  genes1s!"));
    assert.equal(glyphKey("Ｃｈｏｇ"), glyphKey("chog"));
    // Cyrillic о and с in place of the Latin letters.
    assert.equal(glyphKey("Сhоg"), glyphKey("Chog"));
    assert.equal(glyphKey("Chög"), glyphKey("Chog"));
  });

  it("gives nothing for a name too short to compare", () => {
    assert.equal(glyphKey("X"), "");
    assert.equal(glyphKey("  -- "), "");
    assert.equal(glyphKey(null), "");
  });
});

describe("trustOf", () => {
  it("reads the tier by address, whatever the contract calls itself", () => {
    assert.equal(trust(CHOG, { name: "Anything" }).tier, "verified");
    assert.equal(trust(CHOG.toLowerCase(), {}).tier, "verified");
    assert.equal(trust(SCAM, { name: "Chog Genesis" }).tier, "blocked");
    assert.equal(trust(SCAM, { name: "Chog Genesis" }).lookalike, null);
  });

  it("flags an unverified contract named like a verified one", () => {
    assert.equal(trust(OTHER, { name: "Chog Genesis", symbol: "CG" }).lookalike?.address, CHOG);
    assert.equal(trust(OTHER, { symbol: "CH0G" }).lookalike?.address, CHOG);
    assert.equal(trust(OTHER, { symbol: "MUSD" }).lookalike?.address, USD);
  });

  it("leaves a plain unverified contract unflagged", () => {
    const t = trust(OTHER, { name: "Some Other Collection", symbol: "SOC" });
    assert.deepEqual(t, { tier: "unverified", lookalike: null });
    assert.deepEqual(trust(OTHER, {}), { tier: "unverified", lookalike: null });
  });

  it("never matches across chains", () => {
    assert.equal(trustOf(CHOG, {}, registry, 143).tier, "unverified");
    assert.equal(trustOf(OTHER, { name: "Chog Genesis" }, registry, 143).lookalike, null);
  });
});

describe("sideTrust", () => {
  const map = new Map<string, AssetTrust>([
    [CHOG.toLowerCase(), { tier: "verified", lookalike: null }],
    [SCAM.toLowerCase(), { tier: "blocked", lookalike: null }],
    [OTHER.toLowerCase(), trust(OTHER, { name: "Chog Genesis" })],
  ]);

  it("sorts a side by the care it needs, and MON needs none", () => {
    const side = sideTrust([nativeAsset(5n), nftAsset(CHOG, 1n), nftAsset(SCAM, 2n), erc20Asset(OTHER, 3n)], map);
    assert.equal(side.blocked.length, 1);
    assert.equal(side.unverified.length, 1);
    assert.equal(side.lookalikes[0]?.of.address, CHOG);
    assert.equal(allVerified(side), false);
    assert.equal(allVerified(sideTrust([nativeAsset(1n), nftAsset(CHOG, 1n)], map)), true);
  });

  it("counts a contract it hasn't read yet as unverified", () => {
    const side = sideTrust([erc20Asset(USD, 1n)], new Map());
    assert.equal(side.unverified.length, 1);
  });

  it("checks a trait request by its collection", () => {
    const side = sideTrust([traitAsset(SCAM, `0x${"11".repeat(32)}`, 2)], map);
    assert.equal(side.blocked.length, 1);
  });
});

describe("blockedProblem", () => {
  it("names the blocked asset, and passes anything else", () => {
    assert.match(blockedProblem([nftAsset(CHOG, 1n), nftAsset(SCAM, 1n)], registry, CHAIN) ?? "", /CH0G is on DeClub's blocked list/);
    assert.equal(blockedProblem([nativeAsset(1n), nftAsset(CHOG, 1n), erc20Asset(OTHER, 1n)], registry, CHAIN), null);
  });
});
