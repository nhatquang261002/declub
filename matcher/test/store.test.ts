import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  maxFee: 2n,
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

describe("limits and bans", () => {
  let store: Store;
  const at = (n: number, maker: Address, give: Asset[], want: Asset[], deadline = 1_000n) =>
    store.insert(hash(n), { ...intent(maker, give, want), deadline, nonce: BigInt(n) }, SIG, n);
  beforeEach(() => {
    store = new Store();
    at(1, ALICE, [nft(1n, COLLECTION)], [erc20(TOKEN)]);
    at(2, ALICE, [nft(2n, COLLECTION)], [erc20(TOKEN)]);
    at(3, BOB, [erc20(TOKEN)], [nft(1n, COLLECTION)]);
    at(4, CAROL, [nft(1n, OTHER_NFT)], [erc20(WMON)], 50n);
  });

  it("counts a maker's live intents, stale ones too, but not terminal ones", () => {
    assert.equal(store.countLive(ALICE), 2);
    store.setStatus(hash(1), "stale", "allowance");
    assert.equal(store.countLive(ALICE), 2);
    store.setStatus(hash(2), "cancelled");
    assert.equal(store.countLive(ALICE), 1);
    assert.deepEqual(store.liveByMaker(ALICE.toLowerCase() as Address).map((r) => r.hash), [hash(1)]);
  });

  it("pages through live intents from a cursor", () => {
    const first = store.live({ limit: 3 });
    assert.deepEqual(first.map((r) => r.hash), [hash(1), hash(2), hash(3)]);
    const last = first[2]!;
    assert.deepEqual(store.live({ after: { createdAt: last.createdAt, hash: last.hash }, limit: 3 }).map((r) => r.hash), [hash(4)]);
    assert.equal(store.live().length, 4);
  });

  it("leaves banned makers, banned tokens, unlisted tokens and near deadlines out of the matchable window", () => {
    const hashes = (f: Partial<Parameters<Store["matchable"]>[0]>) =>
      store.matchable({ limit: 500, minDeadline: 0, ...f }).map((r) => r.hash);
    assert.deepEqual(hashes({}), [hash(1), hash(2), hash(3), hash(4)]);
    assert.deepEqual(hashes({ minDeadline: 100 }), [hash(1), hash(2), hash(3)]);
    assert.deepEqual(hashes({ excludeMakers: [ALICE.toLowerCase()] }), [hash(3), hash(4)]);
    assert.deepEqual(hashes({ excludeTokens: [TOKEN.toLowerCase()] }), [hash(4)]);
    assert.deepEqual(hashes({ onlyTokens: new Set([COLLECTION, TOKEN].map((t) => t.toLowerCase())) }), [hash(1), hash(2), hash(3)]);
    assert.deepEqual(hashes({ limit: 2, excludeMakers: [ALICE.toLowerCase()] }), [hash(3), hash(4)], "excluded rows don't use up the limit");
  });

  it("bans tokens until a time, never shortening a ban, and keeps bans and strikes across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "matcher-store-"));
    try {
      const path = join(dir, "pool.sqlite");
      const disk = new Store(path);
      disk.banToken(TOKEN, 5_000, "reverted");
      disk.banToken(TOKEN, 2_000, "again"); // shorter: keeps 5_000
      disk.recordStrike(BOB, hash(9), 1);
      disk.close();
      const again = new Store(path);
      assert.deepEqual([...again.bannedTokens(4_999)], [TOKEN.toLowerCase()]);
      assert.deepEqual([...again.bannedTokens(5_000)], []);
      assert.equal(again.strikeCount(BOB, 0), 1);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bans makers on failures or on strikes, each in its own window", () => {
    const opts = { failuresSince: 100, maxFailures: 2, strikesSince: 10, maxStrikes: 2 };
    store.recordFailure(ALICE, hash(1), "allowance", 150);
    assert.deepEqual([...store.bannedMakers(opts)], []);
    store.recordFailure(ALICE, hash(1), "allowance", 160);
    store.recordStrike(BOB, hash(9), 20);
    assert.deepEqual([...store.bannedMakers(opts)], [ALICE.toLowerCase()]);
    store.recordStrike(BOB, hash(10), 30);
    assert.deepEqual([...store.bannedMakers(opts)].sort(), [ALICE, BOB].map((a) => a.toLowerCase()).sort());
    assert.deepEqual([...store.bannedMakers({ ...opts, strikesSince: 25 })], [ALICE.toLowerCase()]);
    assert.equal(store.strikeCount(BOB, 0), 2);
  });
});
