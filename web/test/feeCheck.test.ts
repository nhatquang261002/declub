import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryResponse } from "@envio-dev/hypersync-client";
import { encodeAbiParameters, encodeEventTopics, parseEther, type Address, type Hex } from "viem";
import { deClubEscrowAbi, deClubIntentsAbi } from "../lib/abi";
import { checkFees, feesOnChain, firstBlockAt } from "../lib/server/feeCheck";
import type { HypersyncLike } from "../lib/server/hypersyncScan";

const ESCROW: Address = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const INTENTS: Address = "0x57E02b63dFDEd9d5cF327C20328227Cf6877dE55";
const RECIPIENT: Address = "0xaaaa000000000000000000000000000000000001";
const WMON: Address = "0xbbbb000000000000000000000000000000000002";

type Row = { block: number; address: Address; data: Hex; topics: Hex[] };

const escrowFee = (block: number, tradeId: bigint, amount: bigint): Row => ({
  block,
  address: ESCROW,
  topics: encodeEventTopics({ abi: deClubEscrowAbi, eventName: "FeeCharged", args: { tradeId, recipient: RECIPIENT } } as never) as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }], [amount]),
});
const intentsFee = (block: number, amount: bigint): Row => ({
  block,
  address: INTENTS,
  topics: encodeEventTopics({ abi: deClubIntentsAbi, eventName: "FeeCharged", args: { recipient: RECIPIENT, token: WMON } } as never) as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }], [amount]),
});

/** A fake Envio holding these logs; it answers like the real one for an address and topic0 filter. */
function fakeHypersync(rows: Row[]): HypersyncLike {
  return {
    getHeight: async () => 1_000,
    async get(query) {
      const filter = query.logs![0] as { address: string[]; topics: string[][] };
      const logs = rows
        .filter((r) => r.block >= query.fromBlock && r.block < (query.toBlock ?? Infinity))
        .filter((r) => filter.address.map((a) => a.toLowerCase()).includes(r.address.toLowerCase()) && filter.topics[0].includes(r.topics[0]))
        .map((r) => ({ blockNumber: r.block, address: r.address, data: r.data, topics: r.topics }));
      return { nextBlock: query.toBlock ?? 1_001, totalExecutionTime: 0, data: { blocks: [], transactions: [], logs, traces: [] } } as QueryResponse;
    },
  };
}

const club = (fees: string, signedFees?: string) => ({ club: "0x1", fees, ...(signedFees ? { signedFees } : {}) }) as never;

describe("firstBlockAt", () => {
  // Block b is stamped 10 * b.
  const stamp = async (b: bigint) => Number(b) * 10;

  it("finds the first block stamped at or after the time", async () => {
    assert.equal(await firstBlockAt(55, 0n, 100n, stamp), 6n);
    assert.equal(await firstBlockAt(60, 0n, 100n, stamp), 6n);
    assert.equal(await firstBlockAt(0, 0n, 100n, stamp), 0n);
  });

  it("answers one past the end when no block is that late", async () => {
    assert.equal(await firstBlockAt(5_000, 0n, 100n, stamp), 101n);
  });
});

describe("feesOnChain", () => {
  it("adds up the fees of both contracts in the range, and no others", async () => {
    const hs = fakeHypersync([
      escrowFee(10, 1n, parseEther("1")),
      escrowFee(20, 2n, parseEther("2")),
      escrowFee(30, 3n, parseEther("4")), // past the range
      intentsFee(15, parseEther("0.5")),
      { ...escrowFee(12, 9n, parseEther("100")), address: "0xcccc000000000000000000000000000000000003" }, // another contract
    ]);
    assert.deepEqual(await feesOnChain(hs, { escrow: ESCROW, intents: INTENTS }, 10n, 25n), {
      escrow: parseEther("3"),
      intents: parseEther("0.5"),
      charges: 3,
    });
  });

  it("reads only the escrow when there is no intents contract", async () => {
    const hs = fakeHypersync([escrowFee(10, 1n, parseEther("1")), intentsFee(11, parseEther("5"))]);
    assert.deepEqual(await feesOnChain(hs, { escrow: ESCROW }, 0n, 100n), { escrow: parseEther("1"), intents: 0n, charges: 1 });
  });
});

describe("checkFees", () => {
  const onChain = { escrow: parseEther("3"), intents: parseEther("0.5"), charges: 3 };

  it("passes when the Clubs are credited no more than was charged", () => {
    const result = checkFees({ clubs: [club(parseEther("2").toString()), club(parseEther("1.5").toString(), parseEther("0.5").toString())] }, onChain);
    assert.deepEqual(result.problems, []);
    assert.match(result.notes[0], /3 MON from deals \+ 0\.5 MON from signed swaps/);
  });

  it("passes with less credited: a swap with no listed Club or rounding dust pays no one", () => {
    assert.deepEqual(checkFees({ clubs: [club("1")] }, onChain).problems, []);
  });

  it("fails when the deal fees credited exceed what DeClubEscrow charged", () => {
    const { problems } = checkFees({ clubs: [club(parseEther("3.000000000000000001").toString())] }, onChain);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /DeClubEscrow charged only 3 MON/);
  });

  it("fails when the signed-swap fees credited exceed what DeClubIntents charged", () => {
    const { problems } = checkFees({ clubs: [club(parseEther("1").toString(), parseEther("0.6").toString())] }, onChain);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /DeClubIntents charged only 0\.5 MON/);
  });

  it("counts signed fees against the intents contract only, not the escrow", () => {
    // 0.5 of the 1 is signed: 0.5 against the escrow's 3 and 0.5 against the intents' 0.5.
    assert.deepEqual(checkFees({ clubs: [club(parseEther("1").toString(), parseEther("0.5").toString())] }, onChain).problems, []);
  });
});
