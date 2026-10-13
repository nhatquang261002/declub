import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Query, QueryResponse } from "@envio-dev/hypersync-client";
import type { Address, Hex } from "viem";
import type { ChainScan } from "../lib/server/fillWatcher";
import { HYPERSYNC_RANGE, hypersyncScan, tradeCreationTimes, withFallback, type HypersyncLike } from "../lib/server/hypersyncScan";

const ESCROW: Address = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const TOPIC: Hex = `0x${"ab".repeat(32)}`;
const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

type Row = { block: number; index: number; hash: Hex; removed?: boolean };

/** A fake Envio: rows at blocks, a limit on how many blocks one answer covers, and a log of the queries. */
function fakeHypersync(rows: Row[], height: number, pageBlocks = Infinity) {
  const queries: Query[] = [];
  const client: HypersyncLike = {
    getHeight: async () => height,
    async get(query) {
      queries.push(query);
      const stop = Math.min(query.toBlock ?? height + 1, query.fromBlock + pageBlocks);
      const logs = rows
        .filter((r) => r.block >= query.fromBlock && r.block < stop)
        .map((r) => ({ blockNumber: r.block, logIndex: r.index, transactionHash: r.hash, removed: r.removed, topics: [] }));
      return { nextBlock: stop, totalExecutionTime: 0, data: { blocks: [], transactions: [], logs, traces: [] } } as QueryResponse;
    },
  };
  return { client, queries };
}

const scanOf = (client: HypersyncLike, finalized = 1_000n) => hypersyncScan(client, async () => finalized, [ESCROW], [TOPIC]);

describe("hypersyncScan", () => {
  it("asks for the watched contracts and events over the range, the end block being exclusive", async () => {
    const { client, queries } = fakeHypersync([], 1_000);
    await scanOf(client).txs(10n, 19n);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].fromBlock, 10);
    assert.equal(queries[0].toBlock, 20);
    assert.deepEqual(queries[0].logs, [{ address: [ESCROW], topics: [[TOPIC]] }]);
  });

  it("returns each transaction once, in chain order", async () => {
    const rows: Row[] = [
      { block: 15, index: 2, hash: hashOf(3) },
      { block: 12, index: 0, hash: hashOf(1) },
      { block: 12, index: 1, hash: hashOf(1) }, // a second event in the same transaction
      { block: 15, index: 0, hash: hashOf(2) },
      { block: 20, index: 0, hash: hashOf(9) }, // past the range
    ];
    const { client } = fakeHypersync(rows, 1_000);
    assert.deepEqual(await scanOf(client).txs(10n, 19n), [hashOf(1), hashOf(2), hashOf(3)]);
  });

  it("follows a paged answer to the end of the range", async () => {
    const rows: Row[] = [10, 14, 18].map((block) => ({ block, index: 0, hash: hashOf(block) }));
    const { client, queries } = fakeHypersync(rows, 1_000, 4);
    assert.deepEqual(await scanOf(client).txs(10n, 19n), [hashOf(10), hashOf(14), hashOf(18)]);
    assert.deepEqual(
      queries.map((q) => q.fromBlock),
      [10, 14, 18],
    );
  });

  it("skips logs the chain has since removed", async () => {
    const { client } = fakeHypersync([{ block: 11, index: 0, hash: hashOf(1), removed: true }], 1_000);
    assert.deepEqual(await scanOf(client).txs(10n, 19n), []);
  });

  it("fails rather than loop when an answer moves nowhere", async () => {
    const stuck: HypersyncLike = {
      getHeight: async () => 1_000,
      get: async (query) =>
        ({ nextBlock: query.fromBlock, totalExecutionTime: 0, data: { blocks: [], transactions: [], logs: [], traces: [] } }) as QueryResponse,
    };
    await assert.rejects(() => scanOf(stuck).txs(10n, 19n), /stopped at block 10/);
  });

  it("only treats blocks as scanned when both the node and Envio have them", async () => {
    const { client } = fakeHypersync([], 500);
    assert.equal(await scanOf(client, 1_000n).head(), 500n); // Envio is behind the finalized head
    assert.equal(await scanOf(client, 300n).head(), 300n); // Envio is ahead of it
  });

  it("fails the head when Envio rejects the token, though it still reads the height", async () => {
    const revoked: HypersyncLike = {
      getHeight: async () => 1_000,
      get: async () => {
        throw new Error("http response status code 403 Forbidden: Your token has been revoked");
      },
    };
    await assert.rejects(() => scanOf(revoked).head(), /403/);
  });

  it("scans in ranges much wider than the public RPC allows", () => {
    assert.equal(scanOf(fakeHypersync([], 1).client).range, HYPERSYNC_RANGE);
    assert.ok(HYPERSYNC_RANGE > 100);
  });
});

describe("tradeCreationTimes", () => {
  const topicOf = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;

  /** Envio answering a creation query: logs with the trade id in topic 1, and the blocks they are in. */
  function fakeCreations(made: Array<{ id: number; block: number; at: number }>, pageBlocks = Infinity) {
    const queries: Query[] = [];
    const client: HypersyncLike = {
      getHeight: async () => 1_000,
      async get(query) {
        queries.push(query);
        const stop = Math.min(query.toBlock ?? 1_001, query.fromBlock + pageBlocks);
        const here = made.filter((m) => m.block >= query.fromBlock && m.block < stop);
        return {
          nextBlock: stop,
          totalExecutionTime: 0,
          data: {
            blocks: here.map((m) => ({ number: m.block, timestamp: m.at })),
            transactions: [],
            logs: here.map((m) => ({ blockNumber: m.block, topics: [TOPIC, topicOf(m.id)] })),
            traces: [],
          },
        } as QueryResponse;
      },
    };
    return { client, queries };
  }

  it("maps each trade id to the time of the block it was created in, across pages", async () => {
    const { client, queries } = fakeCreations(
      [
        { id: 1, block: 10, at: 1_700_000_010 },
        { id: 2, block: 14, at: 1_700_000_030 },
        { id: 3, block: 14, at: 1_700_000_030 },
      ],
      4,
    );
    const times = await tradeCreationTimes(client, ESCROW, TOPIC, 10n, 19n);
    assert.deepEqual(
      [...times],
      [
        [1n, 1_700_000_010],
        [2n, 1_700_000_030],
        [3n, 1_700_000_030],
      ],
    );
    assert.deepEqual(queries[0].logs, [{ address: [ESCROW], topics: [[TOPIC]] }]);
    assert.deepEqual(queries[0].fieldSelection.block, ["Number", "Timestamp"]);
  });

  it("leaves out a trade whose block it wasn't given", async () => {
    const client: HypersyncLike = {
      getHeight: async () => 1_000,
      get: async (query) =>
        ({
          nextBlock: (query.toBlock ?? 0) + 0,
          totalExecutionTime: 0,
          data: { blocks: [], transactions: [], logs: [{ blockNumber: 12, topics: [TOPIC, topicOf(5)] }], traces: [] },
        }) as QueryResponse,
    };
    assert.equal((await tradeCreationTimes(client, ESCROW, TOPIC, 10n, 19n)).size, 0);
  });
});

describe("withFallback", () => {
  const source = (name: string, over: Partial<ChainScan> = {}): ChainScan => ({
    head: async () => 100n,
    txs: async () => [name as Hex],
    ...over,
  });
  const mute = () => {
    const warn = console.warn;
    console.warn = () => {};
    return () => {
      console.warn = warn;
    };
  };

  it("uses the primary while its head can be read", async () => {
    const scan = withFallback(source("hs", { range: 20_000 }), source("node", { range: 100 }));
    assert.equal(await scan.head(), 100n);
    assert.equal(scan.range, 20_000);
    assert.deepEqual(await scan.txs(1n, 2n), ["hs"]);
  });

  it("scans the node's logs for the run when the primary's head fails, and tries the primary again next run", async () => {
    let down = true;
    const primary = source("hs", {
      range: 20_000,
      head: async () => {
        if (down) throw new Error("timed out");
        return 100n;
      },
    });
    const scan = withFallback(primary, source("node", { range: 100 }));
    const restore = mute();
    try {
      assert.equal(await scan.head(), 100n);
    } finally {
      restore();
    }
    assert.equal(scan.range, 100);
    assert.deepEqual(await scan.txs(1n, 2n), ["node"]);

    down = false;
    await scan.head();
    assert.equal(scan.range, 20_000);
    assert.deepEqual(await scan.txs(1n, 2n), ["hs"]);
  });

  it("lets a failure after the head was read through, so the cursor stays put", async () => {
    const scan = withFallback(
      source("hs", {
        txs: async () => {
          throw new Error("timed out");
        },
      }),
      source("node"),
    );
    await scan.head();
    await assert.rejects(() => scan.txs(1n, 2n), /timed out/);
  });

  it("fails when both can't be read", async () => {
    const broken = source("x", {
      head: async () => {
        throw new Error("no answer");
      },
    });
    const restore = mute();
    try {
      await assert.rejects(() => withFallback(broken, broken).head(), /no answer/);
    } finally {
      restore();
    }
  });
});
