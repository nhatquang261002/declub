import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { type Address, type Hex, getAddress } from "viem";
import type { Reader, Sender } from "../src/chain.ts";
import { Matcher, defaultMatcherConfig } from "../src/matcher.ts";
import { Pool, PoolError, type PoolConfig } from "../src/pool.ts";
import { Store } from "../src/store.ts";
import { AssetType, type Asset, type Intent } from "../src/types.ts";
import { intentToWire } from "../src/wire.ts";

/**
 * A settlement that passes `eth_call` and the gas estimate, then reverts on-chain: what a token
 * (or a contract maker) that acts differently when it counts would do. No real chain needed: the
 * matcher only sees the simulation succeed and the receipt say "reverted".
 */
const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const SWAP = addr(0x5);
const WMON = addr(0xf);
const EVIL = addr(0xe1); // an ERC-20 that delivers in eth_call and reverts for real
const NFT = addr(0xc0);
const [A, B, C, D] = [addr(0xa1), addr(0xb1), addr(0xc1), addr(0xd1)];

const nft = (id: bigint): Asset => ({ assetType: AssetType.ERC721, token: NFT, id, amount: 1n });
const evil = (amount = 5n): Asset => ({ assetType: AssetType.ERC20, token: EVIL, id: 0n, amount });
const intent = (maker: Address, give: Asset[], want: Asset[], nonce: bigint, deadline = 9_999_999_999n): Intent => ({
  maker,
  give,
  want,
  feeToken: WMON,
  maxFee: 0n,
  deadline,
  nonce,
});

function world(poolOver: Partial<PoolConfig> = {}) {
  const store = new Store();
  const calls = { simulate: 0, send: 0 };
  const contracts = new Set<string>();
  const reader = {
    simulateContract: async () => {
      calls.simulate++;
      return {};
    },
    estimateContractGas: async () => 150_000n,
    waitForTransactionReceipt: async () => ({ status: "reverted", blockNumber: 1n }),
    getCode: async ({ address }: { address: Address }) => (contracts.has(address.toLowerCase()) ? "0x6080" : undefined),
    readContract: async () => 0n, // fee() is 0; posting never gets further than that here
  } as unknown as Reader;
  const sender = {
    account: { address: addr(0x99) },
    wallet: {
      writeContract: async () => {
        calls.send++;
        return hash(0x1000 + calls.send);
      },
    },
  } as unknown as Sender;
  const pool = new Pool(store, reader, {
    chainId: 31337,
    swap: SWAP,
    feeToken: WMON,
    minTtlSec: 60,
    maxTtlSec: 3600,
    ...poolOver,
  });
  const matcher = new Matcher(pool, sender, { ...defaultMatcherConfig(SWAP), maxStrikes: 2 });
  let n = 0;
  /** A gives EVIL for NFT #id, B gives NFT #id for EVIL: a pair that matches. */
  const pair = (giver = A, seller = B, id = BigInt(++n)) => {
    store.insert(hash(++n), intent(giver, [evil()], [nft(id)], BigInt(n)), "0x00", n);
    store.insert(hash(++n), intent(seller, [nft(id)], [evil()], BigInt(n)), "0x00", n);
  };
  const body = (i: Intent) => ({ intent: intentToWire(i), signature: `0x${"11".repeat(65)}` });
  return { store, pool, matcher, calls, contracts, pair, body };
}

describe("a settlement that reverts on-chain after a clean simulation", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });

  it("suspends every token in it except the fee token, and strikes the makers giving them", async () => {
    w.pair();
    const report = await w.matcher.runOnce();
    assert.equal(w.calls.send, 1);
    assert.equal(report.reverted.length, 1);
    assert.deepEqual(report.reverted[0]!.bannedTokens.sort(), [EVIL, NFT].map((t) => t.toLowerCase()).sort());
    assert.deepEqual(report.reverted[0]!.struck.sort(), [A, B].sort());
    assert.deepEqual([...w.store.bannedTokens(Date.now())].sort(), [EVIL, NFT].map((t) => t.toLowerCase()).sort());
    assert.equal(w.store.strikeCount(A, 0), 1);
  });

  it("isn't fooled by a fresh nonce or fresh makers: nothing naming the token is sent again", async () => {
    w.pair();
    await w.matcher.runOnce();
    w.pair(A, B); // same makers, new nonces
    w.pair(C, D); // new makers, same token
    const report = await w.matcher.runOnce();
    assert.deepEqual([w.calls.send, w.calls.simulate, report.reverted.length], [1, 1, 0]);
  });

  it("refuses new intents naming a suspended token", async () => {
    w.pair();
    await w.matcher.runOnce();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    await assert.rejects(w.pool.submit(w.body(intent(C, [evil()], [nft(77n)], 1n, deadline))), (e) => e instanceof PoolError && e.code === "token_banned");
  });
});

describe("strikes when every token is allowlisted", () => {
  const allow = new Set([EVIL, NFT].map((t) => t.toLowerCase()));

  it("bans no token, strikes every EOA maker, and leaves a maker out after maxStrikes", async () => {
    const w = world({ tokenAllowlist: allow });
    w.pair(A, B);
    let r = await w.matcher.runOnce();
    assert.deepEqual(r.reverted[0]!.bannedTokens, []);
    assert.deepEqual(r.reverted[0]!.struck.sort(), [A, B].sort());
    assert.equal(w.store.bannedTokens(Date.now()).size, 0);

    w.pair(A, B); // a fresh nonce on both sides
    r = await w.matcher.runOnce();
    assert.equal(r.reverted.length, 1);
    assert.equal(w.calls.send, 2);

    w.pair(A, B); // two strikes each: they're out
    r = await w.matcher.runOnce();
    assert.deepEqual([r.reverted.length, w.calls.send], [0, 2]);

    w.pair(C, D); // others still trade
    r = await w.matcher.runOnce();
    assert.equal(w.calls.send, 3);
  });

  it("puts the strike on a contract maker rather than its counterparty", async () => {
    const w = world({ tokenAllowlist: allow });
    w.contracts.add(B.toLowerCase());
    w.pair(A, B);
    const r = await w.matcher.runOnce();
    assert.deepEqual(r.reverted[0]!.struck, [B]);
    assert.equal(w.store.strikeCount(A, 0), 0);
  });
});

describe("the token allowlist", () => {
  it("only matches intents whose tokens are all listed (the fee token always is)", async () => {
    const w = world({ tokenAllowlist: new Set([NFT.toLowerCase()]) });
    w.pair();
    assert.equal((await w.matcher.runOnce()).settled.length + w.calls.simulate, 0);
  });

  it("refuses to take an intent naming an unlisted token", async () => {
    const w = world({ tokenAllowlist: new Set([NFT.toLowerCase()]) });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    await assert.rejects(w.pool.submit(w.body(intent(C, [evil()], [nft(1n)], 1n, deadline))), (e) => e instanceof PoolError && e.code === "token_not_allowed");
    // A want in the fee token is fine without listing it; it still fails later (no real chain).
    await assert.rejects(
      w.pool.submit(w.body(intent(C, [nft(1n)], [{ ...evil(), token: WMON }], 2n, deadline))),
      (e) => !(e instanceof PoolError && e.code === "token_not_allowed"),
    );
  });
});
