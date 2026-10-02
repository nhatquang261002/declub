import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { type Address, getAddress, type Hex } from "viem";
import { Store } from "../src/store.ts";
import { AssetType, type Asset, type Intent } from "../src/types.ts";

const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const [ALICE, BOB, CAROL] = [addr(0xa1), addr(0xb2), addr(0xc3)];
const [COLLECTION, OTHER_NFT, TOKEN, WMON] = [addr(0x1001), addr(0x1002), addr(0x2001), addr(0x3001)];
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const nft = (id: bigint, token: Address): Asset => ({ assetType: AssetType.ERC721, token, id, amount: 1n });
const erc20 = (token: Address, amount = 5n): Asset => ({ assetType: AssetType.ERC20, token, id: 0n, amount });
const intent = (maker: Address, give: Asset[], want: Asset[]): Intent => ({
  maker,
  give,
  want,
  feeToken: WMON,
  fee: 2n,
  deadline: 1_000n,
  nonce: 1n,
});
const SIG = "0x00" as Hex;

describe("token filter", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store();
    // 1: gives a collection NFT, wants a token. 2: gives the token, wants another NFT.
    // 3: names neither.
    store.insert(hash(1), intent(ALICE, [nft(7n, COLLECTION)], [erc20(TOKEN)]), SIG, 100);
    store.insert(hash(2), intent(BOB, [erc20(TOKEN)], [nft(9n, OTHER_NFT)]), SIG, 200);
    store.insert(hash(3), intent(CAROL, [nft(1n, OTHER_NFT)], [erc20(WMON)]), SIG, 300);
  });

  it("finds intents that name a token on either side, whatever the id", () => {
    assert.deepEqual(store.list({ token: COLLECTION }).map((r) => r.hash), [hash(1)]);
    assert.deepEqual(store.list({ token: TOKEN }).map((r) => r.hash), [hash(1), hash(2)]);
    assert.deepEqual(store.list({ token: OTHER_NFT }).map((r) => r.hash), [hash(2), hash(3)]);
  });

  it("matches the address in any case and never part of one", () => {
    assert.equal(store.list({ token: COLLECTION.toLowerCase() as Address }).length, 1);
    assert.equal(store.list({ token: addr(0x100) }).length, 0);
    assert.equal(store.list({ token: addr(0x10010) }).length, 0);
  });

  it("combines with the other filters", () => {
    assert.deepEqual(store.list({ token: TOKEN, maker: BOB }).map((r) => r.hash), [hash(2)]);
    assert.deepEqual(store.list({ token: TOKEN, status: "settled" }), []);
  });
});

describe("settlements", () => {
  let store: Store;
  const settle = (tx: number, hashes: number[], at: number) => {
    for (const h of hashes) store.setStatus(hash(h), "settled", null, hash(tx));
    store.recordSettlement({ txHash: hash(tx), blockNumber: tx, at, hashes: hashes.map(hash) });
  };
  beforeEach(() => {
    store = new Store();
    store.insert(hash(1), intent(ALICE, [nft(7n, COLLECTION)], [erc20(TOKEN)]), SIG, 1);
    store.insert(hash(2), intent(BOB, [erc20(TOKEN)], [nft(7n, COLLECTION)]), SIG, 2);
    store.insert(hash(3), intent(CAROL, [nft(1n, OTHER_NFT)], [erc20(WMON)]), SIG, 3);
    store.insert(hash(4), intent(BOB, [erc20(WMON)], [nft(1n, OTHER_NFT)]), SIG, 4);
    settle(900, [1, 2], 5_000);
    settle(901, [3, 4], 6_000);
  });

  it("lists newest first, and by token", () => {
    assert.deepEqual(store.settlements().map((s) => s.txHash), [hash(901), hash(900)]);
    assert.deepEqual(store.settlements({ token: COLLECTION }).map((s) => s.txHash), [hash(900)]);
    assert.deepEqual(store.settlements({ token: OTHER_NFT }).map((s) => s.txHash), [hash(901)]);
    assert.deepEqual(store.settlements({ token: addr(0x9999) }), []);
  });

  it("names a token that only the other side of a cycle holds", () => {
    // TOKEN is in both intents of 900 and in no intent of 901.
    assert.deepEqual(store.settlements({ token: TOKEN }).map((s) => s.txHash), [hash(900)]);
    assert.deepEqual(store.settlements({ token: WMON }).map((s) => s.txHash), [hash(901)]);
  });

  it("pages forward from a time, oldest first, without skipping", () => {
    assert.deepEqual(store.settlements({ after: 0 }).map((s) => s.txHash), [hash(900), hash(901)]);
    assert.deepEqual(store.settlements({ after: 5_000 }).map((s) => s.txHash), [hash(901)]);
    assert.deepEqual(store.settlements({ after: 6_000 }), []);
    assert.deepEqual(store.settlements({ after: 0, limit: 1 }).map((s) => s.txHash), [hash(900)]);
  });

  it("combines token, maker and after", () => {
    assert.deepEqual(store.settlements({ token: OTHER_NFT, maker: CAROL }).map((s) => s.txHash), [hash(901)]);
    assert.deepEqual(store.settlements({ token: OTHER_NFT, maker: ALICE }), []);
    assert.deepEqual(store.settlements({ token: COLLECTION, after: 5_000 }), []);
  });
});
