import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { deClubEscrowAbi } from "../lib/abi";
import { readActivity, type ReceiptLike, type Reader } from "../lib/server/activity";
import { listFills } from "../lib/server/fills";
import { cronAuthorized, cursorKey, startBlockFromEnv, watchFills, type ChainScan, type WatchOptions } from "../lib/server/fillWatcher";
import { memoryStore, type Store } from "../lib/server/store";

const ESCROW: Address = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const NFT: Address = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const maker: Address = getAddress("0xaaaa000000000000000000000000000000000001");
const taker: Address = getAddress("0xbbbb000000000000000000000000000000000002");
const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

function log(address: Address, eventName: string, args: Record<string, unknown>, logIndex = 0) {
  const item = deClubEscrowAbi.find((i) => i.type === "event" && i.name === eventName);
  if (!item || item.type !== "event") throw new Error(`no event ${eventName}`);
  const topics = encodeEventTopics({ abi: deClubEscrowAbi, eventName, args } as never) as Hex[];
  const inputs = item.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(inputs, inputs.map((i) => args[i.name as string]) as never);
  return { address, data, topics, logIndex };
}

const escrowFill = (tradeId: bigint) => log(ESCROW, "TradeFilled", { tradeId, maker, taker });
const escrowCreate = (tradeId: bigint) =>
  log(ESCROW, "TradeCreated", { tradeId, maker, taker: zeroAddress, offered: [{ assetType: 2, token: NFT, id: 1n, amount: 1n }], requested: [], expiry: 0n });

/**
 * A fake chain: transactions placed at block numbers, a finalized head that can move, and a record of
 * every log query, so a test can check which ranges were scanned.
 */
function fakeChain(head: bigint) {
  const blocks = new Map<bigint, { hash: Hex; receipt: ReceiptLike }[]>();
  const queries: [bigint, bigint][] = [];
  const missing = new Set<Hex>();
  const state = { head };
  const chain = {
    state,
    queries,
    missing,
    put(block: bigint, hash: Hex, logs: ReturnType<typeof log>[]) {
      blocks.set(block, [...(blocks.get(block) ?? []), { hash, receipt: { status: "success", blockNumber: block, logs } }]);
    },
    scan: {
      head: async () => state.head,
      async txs(from, to) {
        queries.push([from, to]);
        const found: Hex[] = [];
        for (let b = from; b <= to; b++) for (const tx of blocks.get(b) ?? []) found.push(tx.hash);
        return found;
      },
    } satisfies ChainScan,
    reader: {
      async receipt(hash) {
        if (missing.has(hash)) return null;
        for (const txs of blocks.values()) for (const tx of txs) if (tx.hash === hash) return tx.receipt;
        return null;
      },
      timestamp: async () => 1_800_000_000,
      trade: async () => ({ offered: [], requested: [] }),
      proposalAssets: async () => [],
    } satisfies Reader,
  };
  return chain;
}

describe("watchFills", () => {
  let store: Store;
  beforeEach(() => {
    store = memoryStore();
  });

  const run = (chain: ReturnType<typeof fakeChain>, over: WatchOptions = {}) =>
    watchFills(store, {
      scan: chain.scan,
      reader: chain.reader,
      range: 100,
      parallel: 2,
      activity: { contracts: [ESCROW], clubOf: (t) => (t.toLowerCase() === NFT.toLowerCase() ? NFT : null) },
      ...over,
    });

  it("starts at the head on its first run when no start block is set", async () => {
    const chain = fakeChain(500n);
    chain.put(400n, hashOf(1), [escrowFill(1n)]);
    const result = await run(chain);
    assert.deepEqual(result, { status: "scanned", cursor: 500, head: 500, behind: 0, transactions: 0, fills: 0, events: 0 });
    assert.deepEqual(chain.queries, []);
    assert.equal(await store.get(cursorKey()), 500);
  });

  it("scans from the start block in chunks, recording fills and Club activity", async () => {
    const chain = fakeChain(250n);
    chain.put(10n, hashOf(1), [escrowFill(1n)]);
    chain.put(150n, hashOf(2), [escrowCreate(2n)]);
    chain.put(250n, hashOf(3), [escrowFill(3n)]);
    const result = await run(chain, { startBlock: 1n });
    assert.deepEqual(chain.queries, [
      [1n, 100n],
      [101n, 200n],
      [201n, 250n],
    ]);
    assert.deepEqual(result, { status: "scanned", cursor: 250, head: 250, behind: 0, transactions: 3, fills: 2, events: 1 });
    assert.deepEqual(await listFills(store, ESCROW, taker), ["3", "1"]);
    assert.equal((await readActivity(store, NFT))[0].deal, "2");
  });

  it("picks up from its cursor, and only scans new blocks", async () => {
    const chain = fakeChain(100n);
    await run(chain, { startBlock: 1n });
    chain.queries.length = 0;

    assert.equal((await run(chain)).status, "scanned");
    assert.deepEqual(chain.queries, [], "nothing new at the same head");

    chain.state.head = 130n;
    chain.put(120n, hashOf(4), [escrowFill(4n)]);
    // The start block only matters before there is a cursor.
    const result = await run(chain, { startBlock: 1n });
    assert.deepEqual(chain.queries, [[101n, 130n]]);
    assert.equal(result.status === "scanned" && result.fills, 1);
  });

  it("records nothing twice when blocks are scanned again", async () => {
    const chain = fakeChain(100n);
    chain.put(50n, hashOf(1), [escrowFill(1n)]);
    chain.put(60n, hashOf(2), [escrowCreate(2n)]);
    await run(chain, { startBlock: 1n });
    await store.del(cursorKey());
    await run(chain, { startBlock: 1n });
    assert.deepEqual(await listFills(store, ESCROW, taker), ["1"]);
    assert.equal((await readActivity(store, NFT)).length, 1);
  });

  it("stops starting new work when its budget is spent, and leaves the rest for the next run", async () => {
    const chain = fakeChain(1_000n);
    let clock = 0;
    // Each log query takes 10 s on this clock; the budget allows the first batch of two only.
    const scan: ChainScan = { head: chain.scan.head, txs: async (from, to) => ((clock += 10_000), chain.scan.txs(from, to)) };
    const first = await run(chain, { scan, startBlock: 1n, budgetMs: 15_000, now: () => clock });
    assert.deepEqual(first, { status: "scanned", cursor: 200, head: 1_000, behind: 800, transactions: 0, fills: 0, events: 0 });

    clock = 0;
    const second = await run(chain, { scan, budgetMs: 15_000, now: () => clock });
    assert.equal(second.status === "scanned" && second.cursor, 400);
  });

  it("keeps the cursor before a chunk it couldn't finish, and frees the lock", async () => {
    const chain = fakeChain(300n);
    chain.put(50n, hashOf(1), [escrowFill(1n)]);
    chain.put(150n, hashOf(2), [escrowFill(2n)]);
    chain.missing.add(hashOf(2));
    await assert.rejects(run(chain, { startBlock: 1n }), /no receipt/);
    assert.equal(await store.get(cursorKey()), 100);

    chain.missing.clear();
    const retry = await run(chain);
    assert.equal(retry.status === "scanned" && retry.cursor, 300);
    assert.deepEqual(await listFills(store, ESCROW, taker), ["2", "1"]);
  });

  it("doesn't run while another run holds the lock", async () => {
    const chain = fakeChain(100n);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow: ChainScan = { head: async () => (await held, chain.state.head), txs: chain.scan.txs };
    const first = run(chain, { scan: slow, startBlock: 1n });
    assert.deepEqual(await run(chain), { status: "busy" });
    release();
    assert.equal((await first).status, "scanned");
    assert.equal((await run(chain)).status, "scanned", "the lock is released after a run");
  });
});

describe("cron helpers", () => {
  it("accepts only the exact bearer secret", () => {
    const req = (auth?: string) => new Request("https://x/api/cron/fills", { headers: auth ? { authorization: auth } : {} });
    assert.equal(cronAuthorized(req("Bearer s3cret"), "s3cret"), true);
    assert.equal(cronAuthorized(req("Bearer s3cre"), "s3cret"), false);
    assert.equal(cronAuthorized(req("s3cret"), "s3cret"), false);
    assert.equal(cronAuthorized(req(), "s3cret"), false);
  });

  it("reads a start block only when it is a number", () => {
    assert.equal(startBlockFromEnv(" 66352698 "), 66352698n);
    assert.equal(startBlockFromEnv(""), undefined);
    assert.equal(startBlockFromEnv("latest"), undefined);
    assert.equal(startBlockFromEnv(undefined), undefined);
  });
});
