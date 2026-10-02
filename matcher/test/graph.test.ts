import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import { findCycles, selectCycles, type Node } from "../src/graph.ts";
import { AssetType, type Asset, type Intent } from "../src/types.ts";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const CHOG = addr(0xc0);
const USD = addr(0xd0);
const WETH = addr(0xe0);

const nft = (id: number, token = CHOG): Asset => ({
  assetType: AssetType.ERC721,
  token,
  id: BigInt(id),
  amount: 1n,
});
const erc20 = (amount: number, token = USD): Asset => ({
  assetType: AssetType.ERC20,
  token,
  id: 0n,
  amount: BigInt(amount),
});

let seq = 0;
const node = (maker: number, give: Asset[], want: Asset[], createdAt = ++seq): Node => ({
  hash: `0x${(++seq).toString(16).padStart(64, "0")}` as Hex,
  createdAt,
  intent: {
    maker: addr(maker),
    give,
    want,
    feeToken: addr(0xf0),
    maxFee: 0n,
    deadline: 9999999999n,
    nonce: BigInt(seq),
  } satisfies Intent,
});

const ids = (nodes: Node[], cycles: number[][]) =>
  cycles.map((c) => c.map((i) => Number(nodes[i]!.intent.maker)));

describe("findCycles", () => {
  it("finds a plain swap exactly once", () => {
    const nodes = [node(1, [nft(1)], [erc20(100)]), node(2, [erc20(100)], [nft(1)])];
    assert.deepEqual(ids(nodes, findCycles(nodes)), [[1, 2]]);
  });

  it("finds nothing when only one side matches", () => {
    const nodes = [node(1, [nft(1)], [erc20(100)]), node(2, [erc20(100)], [nft(2)])];
    assert.deepEqual(findCycles(nodes), []);
  });

  it("treats an ERC-20 want as a floor and an NFT want as exact", () => {
    const floor = [node(1, [nft(1)], [erc20(100)]), node(2, [erc20(150)], [nft(1)])];
    assert.equal(findCycles(floor).length, 1);
    const short = [node(1, [nft(1)], [erc20(100)]), node(2, [erc20(99)], [nft(1)])];
    assert.equal(findCycles(short).length, 0);
    const otherId = [node(1, [nft(1)], [erc20(100)]), node(2, [erc20(100)], [nft(2)])];
    assert.equal(findCycles(otherId).length, 0);
  });

  it("accepts surplus: the giver may give more than was asked", () => {
    const nodes = [
      node(1, [nft(1)], [erc20(100)]),
      node(2, [erc20(100), nft(7)], [nft(1)]),
    ];
    assert.equal(findCycles(nodes).length, 1);
  });

  it("needs every wanted asset covered by one giver", () => {
    const nodes = [
      node(1, [nft(1)], [erc20(100), nft(5)]),
      node(2, [erc20(100)], [nft(1)]),
    ];
    assert.equal(findCycles(nodes).length, 0);
  });

  it("finds a ring of three that no pair could settle", () => {
    // 1 gives NFT#1 wants WETH, 2 gives WETH wants USD, 3 gives USD wants NFT#1.
    const nodes = [
      node(1, [nft(1)], [erc20(1, WETH)]),
      node(2, [erc20(1, WETH)], [erc20(5)]),
      node(3, [erc20(5)], [nft(1)]),
    ];
    const cycles = findCycles(nodes);
    assert.equal(cycles.length, 1);
    // cycle[i].give goes to cycle[i+1].maker, and 3 is the one who wants 1's NFT: 1 → 3 → 2.
    assert.deepEqual(ids(nodes, cycles), [[1, 3, 2]]);
  });

  it("finds a ring of four and stops at MAX_CYCLE", () => {
    const four = [
      node(1, [nft(1)], [nft(4)]),
      node(2, [nft(2)], [nft(1)]),
      node(3, [nft(3)], [nft(2)]),
      node(4, [nft(4)], [nft(3)]),
    ];
    assert.equal(findCycles(four).length, 1);
    assert.equal(findCycles(four)[0]!.length, 4);

    // Each wants the previous one's NFT, so the ring only closes through all five.
    const ring5 = [
      node(1, [nft(1)], [nft(5)]),
      node(2, [nft(2)], [nft(1)]),
      node(3, [nft(3)], [nft(2)]),
      node(4, [nft(4)], [nft(3)]),
      node(5, [nft(5)], [nft(4)]),
    ];
    assert.equal(findCycles(ring5).length, 0);
    assert.equal(findCycles(ring5, { maxCycle: 5 }).length, 1);
  });

  it("never puts one maker in a cycle twice", () => {
    // Maker 1 has two intents that would otherwise close a ring through each other.
    const nodes = [
      node(1, [nft(1)], [nft(2)]),
      node(1, [nft(2)], [nft(1)]),
      node(2, [nft(9)], [nft(8)]),
    ];
    assert.deepEqual(findCycles(nodes), []);
  });

  it("finds every distinct cycle, each once", () => {
    // Two sellers of the same NFT for the same price: 1 can pair with 2 or with 3.
    const nodes = [
      node(1, [nft(1)], [erc20(100)]),
      node(2, [erc20(100)], [nft(1)]),
      node(3, [erc20(120)], [nft(1)]),
    ];
    assert.equal(findCycles(nodes).length, 2);
  });

  it("caps the number of cycles it enumerates", () => {
    const nodes: Node[] = [];
    for (let i = 0; i < 30; i++) nodes.push(node(100 + i, [nft(1)], [erc20(1)]));
    for (let i = 0; i < 30; i++) nodes.push(node(200 + i, [erc20(1)], [nft(1)]));
    assert.equal(findCycles(nodes, { maxCycles: 50 }).length, 50);
  });
});

describe("selectCycles", () => {
  it("prefers more intents settled over older ones", () => {
    const nodes = [
      node(1, [nft(1)], [erc20(100)], 10), //  pairs with 2 or 3, or rings through 5 and 4
      node(2, [erc20(100)], [nft(1)], 1), //   oldest of all
      node(3, [erc20(100)], [nft(1)], 2),
      node(4, [erc20(100)], [nft(2)], 20),
      node(5, [nft(2)], [nft(1)], 30),
    ];
    // Ring 1 → 5 → 4 → 1 settles three intents; either pair settles only two.
    assert.deepEqual(ids(nodes, selectCycles(nodes, findCycles(nodes))), [[1, 5, 4]]);
  });

  it("among equal sizes picks the cycle holding the oldest intent", () => {
    const nodes = [
      node(1, [nft(1)], [erc20(100)], 10),
      node(2, [erc20(100)], [nft(1)], 50), // newer
      node(3, [erc20(100)], [nft(1)], 2), // older
    ];
    const [best] = selectCycles(nodes, findCycles(nodes));
    assert.deepEqual(ids(nodes, [best!]), [[1, 3]]);
  });

  it("does not use one intent or one maker twice", () => {
    const nodes = [
      node(1, [nft(1)], [erc20(100)], 1),
      node(2, [erc20(100)], [nft(1)], 2),
      node(2, [erc20(100)], [nft(1)], 3), // same maker as above
      node(3, [erc20(100)], [nft(1)], 4),
    ];
    const picked = selectCycles(nodes, findCycles(nodes));
    assert.equal(picked.length, 1);
  });

  it("settles two unrelated pairs in one pass", () => {
    const nodes = [
      node(1, [nft(1)], [erc20(100)]),
      node(2, [erc20(100)], [nft(1)]),
      node(3, [nft(2)], [erc20(50, WETH)]),
      node(4, [erc20(50, WETH)], [nft(2)]),
    ];
    assert.equal(selectCycles(nodes, findCycles(nodes)).length, 2);
  });
});
