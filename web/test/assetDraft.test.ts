import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { assetsToDraft, draftToAssets } from "../lib/assetDraft";
import { erc20Asset, nativeAsset, nftAsset, traitAsset } from "../lib/assets";

const CHOG = getAddress("0x00000000000000000000000000000000000000c1");
const WMON = getAddress("0x00000000000000000000000000000000000000c2");
const decimalsOf = (token: string) => (token === WMON ? 18 : undefined);

// "Create a matching swap" fills the form from another maker's swap: what they want is what you
// give, and what they give is what you want.
describe("assetsToDraft", () => {
  it("round-trips NFTs and token amounts through the form", () => {
    const assets = [nftAsset(CHOG, 7n), erc20Asset(WMON, 1_500_000_000_000_000_000n)];
    const rows = assetsToDraft(assets, decimalsOf);
    assert.ok(rows);
    assert.equal(rows[1].value, "1.5");
    assert.deepEqual(draftToAssets(rows, decimalsOf).assets, assets);
  });

  it("waits for the token's decimals instead of guessing an amount", () => {
    assert.equal(assetsToDraft([erc20Asset(CHOG, 5n)], decimalsOf), null);
  });

  it("refuses what a signed swap can't hold", () => {
    assert.equal(assetsToDraft([nativeAsset(1n)], decimalsOf), null);
    assert.equal(assetsToDraft([traitAsset(CHOG, "0x00", 1)], decimalsOf), null);
  });
});
