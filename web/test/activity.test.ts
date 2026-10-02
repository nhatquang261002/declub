import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { onDealV2Abi } from "../lib/abi";
import { ON_DEAL_ADDRESS } from "../lib/config";
import { activityKey, ingestTx, readActivity, recordActivity, type ReceiptLike, type Reader } from "../lib/server/activity";
import { fillsKey, listFills, recordFills } from "../lib/server/fills";
import { memoryStore, type Store } from "../lib/server/store";

const V2: Address = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const NFT: Address = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const USD: Address = "0xd300f095f456D59AAc122B0100833fE195136F6c";
const OTHER: Address = getAddress("0x00000000000000000000000000000000000000f1");
const maker: Address = getAddress("0xaaaa000000000000000000000000000000000001");
const taker: Address = getAddress("0xbbbb000000000000000000000000000000000002");
const HASH = ("0x" + "ab".repeat(32)) as Hex;
const HASH2 = ("0x" + "cd".repeat(32)) as Hex;
const AT = 1_800_000_000;

const nft = (token: Address, id = 1n) => ({ assetType: 2, token, id, amount: 1n });
const erc20 = (token: Address, amount = 5n) => ({ assetType: 1, token, id: 0n, amount });
const mon = (amount = 1n) => ({ assetType: 0, token: zeroAddress, id: 0n, amount });
type Raw = ReturnType<typeof nft>;

/** A log encoded the way the contract emits it, from the ABI. */
function log(address: Address, eventName: string, args: Record<string, unknown>, logIndex = 0) {
  const item = onDealV2Abi.find((i) => i.type === "event" && i.name === eventName);
  if (!item || item.type !== "event") throw new Error(`no event ${eventName}`);
  const topics = encodeEventTopics({ abi: onDealV2Abi, eventName, args } as never) as Hex[];
  const data = encodeAbiParameters(
    item.inputs.filter((i) => !i.indexed),
    item.inputs.filter((i) => !i.indexed).map((i) => args[i.name as string]) as never,
  );
  return { address, data, topics, logIndex };
}

const created = (offered: Raw[], requested: Raw[], logIndex = 0, address = V2) =>
  log(address, "TradeCreated", { tradeId: 7n, maker, taker: zeroAddress, offered, requested, expiry: 0n }, logIndex);
const filled = (logIndex = 0, address = V2) => log(address, "TradeFilled", { tradeId: 7n, maker, taker }, logIndex);
const receipt = (logs: ReturnType<typeof log>[], status: "success" | "reverted" = "success"): ReceiptLike => ({ status, blockNumber: 99n, logs });

function fakeReader(over: { receipt?: Reader["receipt"]; trade?: { offered: Raw[]; requested: Raw[] }; proposal?: Raw[] } = {}) {
  const calls = { timestamp: 0, trade: 0, proposal: 0 };
  const reader: Reader = {
    receipt: over.receipt ?? (async () => null),
    async timestamp() {
      calls.timestamp++;
      return AT;
    },
    async trade() {
      calls.trade++;
      return over.trade ?? { offered: [], requested: [] };
    },
    async proposalAssets() {
      calls.proposal++;
      return over.proposal ?? [];
    },
  };
  return { reader, calls };
}

const clubOf = (token: string) => [NFT, USD].find((t) => t.toLowerCase() === token.toLowerCase()) ?? null;
const opts = (reader: Reader) => ({ reader, contracts: [V2], clubOf });

describe("recordActivity", () => {
  let store: Store;
  beforeEach(() => {
    store = memoryStore();
  });

  it("logs a new deal in the Club of each Club asset it names", async () => {
    const { reader } = fakeReader();
    const n = await recordActivity(store, HASH, receipt([created([nft(NFT), mon()], [erc20(USD), nft(OTHER)])]), opts(reader));
    assert.equal(n, 1);
    for (const club of [NFT, USD]) {
      const [event] = await readActivity(store, club);
      assert.deepEqual(event, {
        id: `${HASH}:0`,
        kind: "created",
        contract: V2.toLowerCase(),
        deal: "7",
        block: 99,
        at: AT,
        parties: [maker.toLowerCase()],
        tokens: [NFT.toLowerCase(), USD.toLowerCase(), OTHER.toLowerCase()],
      });
    }
    assert.deepEqual(await readActivity(store, OTHER), []);
  });

  it("logs a deal once in a Club whose two assets it names, under the Club's own asset", async () => {
    const { reader } = fakeReader();
    const paired = { ...opts(reader), clubOf: (token: string) => ([NFT, USD].some((t) => t.toLowerCase() === token.toLowerCase()) ? NFT : null) };
    assert.equal(await recordActivity(store, HASH, receipt([created([nft(NFT)], [erc20(USD)])]), paired), 1);
    assert.equal((await readActivity(store, NFT)).length, 1);
    assert.deepEqual(await readActivity(store, USD), []);
  });

  it("leaves native MON out of a deal's tokens", async () => {
    const { reader } = fakeReader();
    await recordActivity(store, HASH, receipt([created([nft(NFT)], [mon(3n)])]), opts(reader));
    assert.deepEqual((await readActivity(store, NFT))[0]!.tokens, [NFT.toLowerCase()]);
  });

  it("is idempotent: a replayed report adds nothing", async () => {
    const { reader } = fakeReader();
    const r = receipt([created([nft(NFT)], [])]);
    await recordActivity(store, HASH, r, opts(reader));
    await recordActivity(store, HASH, r, opts(reader));
    assert.equal((await readActivity(store, NFT)).length, 1);
  });

  it("keeps two events of one transaction apart", async () => {
    const { reader } = fakeReader();
    await recordActivity(store, HASH, receipt([created([nft(NFT)], [], 0), created([nft(NFT, 2n)], [], 3)]), opts(reader));
    assert.deepEqual((await readActivity(store, NFT)).map((e) => e.id).sort(), [`${HASH}:0`, `${HASH}:3`]);
  });

  it("drops a deal that names no Club asset, without any further reads", async () => {
    const { reader, calls } = fakeReader();
    const n = await recordActivity(store, HASH, receipt([created([nft(OTHER)], [mon()])]), opts(reader));
    assert.equal(n, 0);
    assert.equal(calls.timestamp, 0);
    assert.deepEqual(await store.ranked(activityKey(OTHER), 10), []);
  });

  it("logs a fill as a swap between maker and taker, with the deal's assets", async () => {
    const { reader, calls } = fakeReader({ trade: { offered: [nft(NFT)], requested: [erc20(USD, 9n)] } });
    await recordActivity(store, HASH, receipt([filled()]), opts(reader));
    assert.equal(calls.trade, 1);
    for (const club of [NFT, USD]) {
      const [event] = await readActivity(store, club);
      assert.equal(event!.kind, "swapped");
      assert.deepEqual(event!.parties, [maker.toLowerCase(), taker.toLowerCase()]);
      assert.deepEqual(event!.tokens, [NFT.toLowerCase(), USD.toLowerCase()]);
    }
  });

  it("adds the proposal's assets when a fill came from accepting one", async () => {
    const { reader, calls } = fakeReader({ trade: { offered: [nft(OTHER)], requested: [] }, proposal: [erc20(USD, 4n)] });
    const accepted = log(V2, "ProposalAccepted", { tradeId: 7n, proposalId: 2n }, 1);
    await recordActivity(store, HASH, receipt([filled(0), accepted]), opts(reader));
    assert.equal(calls.proposal, 1);
    assert.equal((await readActivity(store, USD))[0]!.kind, "swapped");
    assert.deepEqual(await readActivity(store, NFT), []);
  });

  it("ignores events from contracts it isn't watching", async () => {
    const { reader, calls } = fakeReader({ trade: { offered: [nft(NFT)], requested: [] } });
    const n = await recordActivity(store, HASH, receipt([filled(0, OTHER), created([nft(NFT)], [], 1, OTHER)]), opts(reader));
    assert.equal(n, 0);
    assert.equal(calls.trade, 0);
  });

  it("ignores logs that aren't this contract's events", async () => {
    const { reader } = fakeReader();
    const junk = { address: V2, data: "0x" as Hex, topics: [("0x" + "11".repeat(32)) as Hex], logIndex: 0 };
    assert.equal(await recordActivity(store, HASH, receipt([junk]), opts(reader)), 0);
  });

  it("records nothing for a reverted transaction", async () => {
    const { reader } = fakeReader();
    assert.equal(await recordActivity(store, HASH, receipt([created([nft(NFT)], [])], "reverted"), opts(reader)), 0);
    assert.deepEqual(await readActivity(store, NFT), []);
  });

  it("returns a Club's events newest first and skips damaged rows", async () => {
    const { reader } = fakeReader({ trade: { offered: [nft(NFT)], requested: [] } });
    await recordActivity(store, HASH, receipt([created([nft(NFT)], [])]), opts(reader));
    const later = { ...fakeReader({ trade: { offered: [nft(NFT)], requested: [] } }) };
    later.reader.timestamp = async () => AT + 60;
    await recordActivity(store, HASH2, receipt([filled()]), opts(later.reader));
    await store.rank(activityKey(NFT), [{ member: "not json", score: AT + 999 }], 10);
    const events = await readActivity(store, NFT);
    assert.deepEqual(events.map((e) => e.kind), ["swapped", "created"]);
  });

  it("keeps each chain's and each Club's log apart", async () => {
    assert.notEqual(activityKey(NFT), activityKey(USD));
    assert.equal(activityKey(NFT), activityKey(NFT.toLowerCase()));
  });
});

describe("ingestTx", () => {
  it("says pending while the node has no receipt", async () => {
    const { reader } = fakeReader({ receipt: async () => null });
    assert.deepEqual(await ingestTx(memoryStore(), HASH, opts(reader)), { status: "pending" });
  });

  it("reads the receipt and records", async () => {
    const store = memoryStore();
    const { reader } = fakeReader({ receipt: async () => receipt([created([nft(NFT)], [])]) });
    assert.deepEqual(await ingestTx(store, HASH, opts(reader)), { status: "recorded", events: 1 });
    assert.equal((await readActivity(store, NFT)).length, 1);
  });
});

describe("recordFills (shared with History)", () => {
  it("still records a fill under the taker", async () => {
    const store = memoryStore();
    const fill = log(ON_DEAL_ADDRESS, "TradeFilled", { tradeId: 7n, maker, taker });
    assert.equal(await recordFills(store, receipt([fill])), 1);
    assert.deepEqual(await listFills(store, ON_DEAL_ADDRESS, taker), ["7"]);
    assert.equal(fillsKey(ON_DEAL_ADDRESS, taker), fillsKey(ON_DEAL_ADDRESS, taker.toLowerCase()));
  });

  it("records nothing for a reverted transaction or another contract", async () => {
    const store = memoryStore();
    const fill = log(ON_DEAL_ADDRESS, "TradeFilled", { tradeId: 7n, maker, taker });
    assert.equal(await recordFills(store, receipt([fill], "reverted")), 0);
    assert.equal(await recordFills(store, receipt([log(OTHER, "TradeFilled", { tradeId: 7n, maker, taker })])), 0);
  });
});
