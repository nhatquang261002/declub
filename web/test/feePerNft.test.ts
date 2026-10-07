import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { draftToAssets, newRow } from "../lib/assetDraft";
import { erc20Asset, feeUnits, nativeAsset, nftAsset, nftCount, sideFee, traitAsset } from "../lib/assets";
import { MAX_NFTS_PER_SIDE } from "../lib/config";
import { intentProblem } from "../lib/intents";

// The protocol fee is paid per NFT a side moves, and a side moves at most 5 (ADR 0033). These
// mirror DeClubEscrow.feeUnits and the contracts' caps, so the amounts the app sends are the ones
// the contract asks for.
const CHOG = getAddress("0x00000000000000000000000000000000000000c1");
const USD = getAddress("0x00000000000000000000000000000000000000c2");
const ROOT = "0x00000000000000000000000000000000000000000000000000000000000000ab";
const nfts = (n: number) => Array.from({ length: n }, (_, i) => nftAsset(CHOG, BigInt(i + 1)));
const FEE = 2n * 10n ** 18n;

describe("fee units", () => {
  it("counts each NFT, and a trait request's amount", () => {
    assert.equal(nftCount(nfts(3)), 3);
    assert.equal(nftCount([traitAsset(CHOG, ROOT, 2), nftAsset(CHOG, 9n)]), 3);
  });

  it("is at least one, so a side without an NFT still pays", () => {
    assert.equal(feeUnits([nativeAsset(10n ** 18n), erc20Asset(USD, 5n)]), 1n);
    assert.equal(feeUnits([]), 1n);
  });

  it("ignores MON and tokens next to NFTs", () => {
    assert.equal(feeUnits([...nfts(2), nativeAsset(1n), erc20Asset(USD, 1n)]), 2n);
  });

  it("multiplies the per-NFT fee", () => {
    assert.equal(sideFee(FEE, nfts(5)), 5n * FEE);
    assert.equal(sideFee(FEE, [nativeAsset(1n)]), FEE);
    assert.equal(sideFee(0n, nfts(5)), 0n);
  });
});

describe("the NFT cap", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => newRow("erc721", CHOG, String(i + 1)));

  it("allows five NFTs a side and refuses six", () => {
    assert.equal(MAX_NFTS_PER_SIDE, 5);
    assert.deepEqual(draftToAssets(rows(5), () => 18).errors, []);
    assert.deepEqual(draftToAssets(rows(6), () => 18).errors, ["Up to 5 NFTs per side."]);
  });

  it("lets tokens and MON ride along up to the asset cap", () => {
    const withTokens = [...rows(5), newRow("native", "", "1"), newRow("erc20", USD, "1")];
    assert.deepEqual(draftToAssets(withTokens, () => 18).errors, []);
  });

  it("applies to signed swaps on both sides", () => {
    const token = [erc20Asset(USD, 1n)];
    assert.equal(intentProblem(nfts(5), token), null);
    assert.equal(intentProblem(nfts(6), token), "Up to 5 NFTs per side.");
    assert.equal(intentProblem(token, nfts(6).map((a) => ({ ...a, token: getAddress("0x00000000000000000000000000000000000000c9") }))), "Up to 5 NFTs per side.");
  });
});
