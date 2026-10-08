import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { erc20Asset, nativeAsset, nftAsset, traitAsset, type TokenInfo } from "../lib/assets";
import { dealPost, dealPostLink, dealTitle, describeAssets, type DealFacts } from "../lib/dealShare";

const CHOG = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4" as const;
const USDC = "0x73591F76d7deE66F683A979cEffb4356982EE1bB" as const;
const info = new Map<string, TokenInfo>([[USDC.toLowerCase(), { symbol: "mUSD", decimals: 6 }]]);
const nameOf = (token: string) => (token === CHOG.toLowerCase() ? "Chog" : undefined);

const facts = (over: Partial<DealFacts> = {}): DealFacts => ({ id: "12", status: "open", give: "Chog #12", want: "3 MON", openOffer: false, ...over });

describe("describeAssets", () => {
  it("groups NFTs by collection and words tokens and MON", () => {
    assert.equal(describeAssets([nftAsset(CHOG, 12n), nftAsset(CHOG, 40n)], info, nameOf), "Chog #12, #40");
    assert.equal(describeAssets([nativeAsset(1_500_000_000_000_000_000n), erc20Asset(USDC, 2_500_000n)], info, nameOf), "1.5 MON + 2.5 mUSD");
    assert.equal(
      describeAssets(
        Array.from({ length: 6 }, (_, i) => nftAsset(CHOG, BigInt(i))),
        info,
        nameOf,
      ),
      "6 Chog",
    );
    assert.equal(describeAssets([traitAsset(CHOG, `0x${"00".repeat(32)}`, 2)], info, nameOf), "2 Chog of a kind");
  });

  it("falls back to a short address for a token it can't name, and says assets for none", () => {
    assert.match(
      describeAssets([nftAsset(USDC, 1n)], info, () => undefined),
      /^0x7359… #1$/,
    );
    assert.equal(describeAssets([], info, nameOf), "assets");
  });
});

describe("the deal's post", () => {
  it("invites on a live offer, announces a swap, and names the Club", () => {
    assert.equal(
      dealPost(facts(), "Chog"),
      "Offering Chog #12 for 3 MON 🤝\n\nIn the Chog Club on DeClub. Escrowed on Monad: both sides or nothing. Take the deal 👇",
    );
    assert.equal(dealPost(facts({ openOffer: true, want: "" })), "Offering Chog #12, open to offers 🤝\n\nOn DeClub. Escrowed on Monad. Make me an offer 👇");
    assert.equal(
      dealPost(facts({ status: "filled" }), "Chog"),
      "Swapped Chog #12 for 3 MON ✅\n\nIn the Chog Club on DeClub. Escrowed on Monad, atomic, done.",
    );
  });

  it("shortens a long list of assets so the post fits with its link", () => {
    const post = dealPost(facts({ give: "x".repeat(200), want: "y".repeat(200) }), "Chog");
    assert.ok(post.length + 24 <= 280);
  });

  it("titles the preview, and links the deal's page", () => {
    assert.equal(dealTitle(facts()), "Chog #12 for 3 MON");
    assert.equal(dealTitle(facts({ openOffer: true })), "Offering Chog #12, open to offers");
    assert.equal(dealTitle(facts({ status: "filled" })), "Swapped: Chog #12 for 3 MON");
    assert.equal(dealTitle(facts({ status: "filled", openOffer: true, want: "assets" })), "Swapped: Chog #12 for an accepted offer");
    const link = new URL(dealPostLink(facts(), "https://declub.app/deal/12", "Chog"));
    assert.equal(link.origin + link.pathname, "https://x.com/intent/post");
    assert.equal(link.searchParams.get("url"), "https://declub.app/deal/12");
    assert.match(link.searchParams.get("text")!, /Chog Club/);
  });
});
