import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getAddress, type Address, type Hex } from "viem";
import { completedSwaps, heat, initials, mergeEvents, settlementEvents, summarize, toClubInfo, type ActivityEvent } from "../lib/clubs";
import { involvesToken, offersToken, requestsToken } from "../lib/dealFiltersV2";
import type { DealV2 } from "../lib/dealsV2";
import type { Settlement } from "../lib/intents";
import { activityKey } from "../lib/server/activity";
import { clubDetail, clubEvents, clubList } from "../lib/server/clubs";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NOW = 1_800_000_000;
const DAY = 86_400;
const NFT: Address = getAddress("0x220a2c52fd27252e7cd6163a7bf1b6ae159d26e4");
const USD: Address = getAddress("0xd300f095f456d59aac122b0100833fe195136f6c");
const OTHER: Address = getAddress("0x00000000000000000000000000000000000000f1");
const [alice, bob, carol] = ["0xaaaa000000000000000000000000000000000001", "0xbbbb000000000000000000000000000000000002", "0xcccc000000000000000000000000000000000003"];

let n = 0;
const event = (over: Partial<ActivityEvent> & Pick<ActivityEvent, "kind">): ActivityEvent => ({
  id: `0x${(++n).toString(16)}:0`,
  contract: "0xswap",
  deal: String(n),
  block: n,
  at: NOW,
  parties: [alice, bob],
  tokens: [NFT.toLowerCase()],
  ...over,
});
const swap = (over: Partial<ActivityEvent> = {}) => event({ kind: "swapped", ...over });
const created = (over: Partial<ActivityEvent> = {}) => event({ kind: "created", parties: [alice], ...over });

describe("summarize", () => {
  it("is all zeros for a Club nobody has traded in", () => {
    assert.deepEqual(summarize([], NOW), { momentum: 0, change: 0, completed7d: 0, created7d: 0, traders30d: 0, lastActive: null });
  });

  it("counts the week, the month and the latest event", () => {
    const events = [
      swap({ at: NOW - DAY }),
      swap({ at: NOW - 20 * DAY, parties: [carol, bob] }),
      created({ at: NOW - 2 * DAY }),
      created({ at: NOW - 9 * DAY }),
    ];
    const s = summarize(events, NOW);
    assert.equal(s.completed7d, 1);
    assert.equal(s.created7d, 1);
    assert.equal(s.traders30d, 3);
    assert.equal(s.lastActive, NOW - DAY);
    assert.ok(s.momentum > 0);
  });

  it("shows momentum rising when this week was busier than the last", () => {
    assert.ok(summarize([swap({ at: NOW - DAY })], NOW).change > 0);
    assert.ok(summarize([swap({ at: NOW - 9 * DAY })], NOW).change < 0);
  });
});

describe("settlementEvents", () => {
  const row = (maker: string, give: { token: string; kind?: string }[], want: { token: string; kind?: string }[]) => ({
    intent: {
      maker,
      give: give.map((a) => ({ kind: "erc721", id: 1n, amount: 1n, ...a })),
      want: want.map((a) => ({ kind: "erc20", id: 0n, amount: 5n, ...a })),
    },
  });
  const settlement = (txHash: string, cycle: unknown[], at = NOW * 1000) => ({ txHash, blockNumber: 77, at, cycle }) as unknown as Settlement;

  it("turns a settled cycle into one swap between every maker", () => {
    const tx = ("0x" + "AB".repeat(32)) as Hex;
    const [e] = settlementEvents([
      settlement(tx, [row(alice, [{ token: NFT }], [{ token: USD }]), row(bob, [{ token: USD }], [{ token: NFT }])]),
    ]);
    assert.equal(e!.kind, "swapped");
    assert.equal(e!.id, `${tx.toLowerCase()}:settled`);
    assert.equal(e!.at, NOW, "pool times are milliseconds");
    assert.equal(e!.block, 77);
    assert.deepEqual(e!.parties, [alice, bob]);
    assert.deepEqual(e!.tokens, [NFT.toLowerCase(), USD.toLowerCase()]);
  });

  it("lists a ring's makers once each, and skips native assets", () => {
    const [e] = settlementEvents([
      settlement("0x01", [
        row(alice, [{ token: NFT }], [{ token: USD }]),
        row(bob, [{ token: USD }], [{ token: OTHER }]),
        row(alice, [{ token: OTHER }], [{ token: NFT }, { token: "0x0000000000000000000000000000000000000000", kind: "native" }]),
      ]),
    ]);
    assert.deepEqual(e!.parties, [alice, bob]);
    assert.ok(!e!.tokens.includes("0x0000000000000000000000000000000000000000"));
  });
});

describe("mergeEvents", () => {
  it("keeps each id once, newest first, with the first source winning", () => {
    const a = swap({ id: "x:0", at: NOW - 10, deal: "from-log" });
    const b = swap({ id: "x:0", at: NOW - 10, deal: "from-pool" });
    const c = created({ id: "y:0", at: NOW });
    const merged = mergeEvents([a], [b, c]);
    assert.deepEqual(merged.map((e) => e.id), ["y:0", "x:0"]);
    assert.equal(merged[1]!.deal, "from-log");
  });

  it("orders events with the same time the same way every time", () => {
    const list = [swap({ id: "b:0" }), swap({ id: "a:0" })];
    assert.deepEqual(mergeEvents(list).map((e) => e.id), mergeEvents([...list].reverse()).map((e) => e.id));
  });
});

describe("completedSwaps", () => {
  it("lists swaps only, newest first, up to the limit", () => {
    const events = [swap({ at: NOW - 3 }), created({ at: NOW }), swap({ at: NOW - 1 }), swap({ at: NOW - 2 })];
    assert.deepEqual(completedSwaps(events, 2).map((e) => e.at), [NOW - 1, NOW - 2]);
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    assert.equal(initials("Mock Chog"), "MC");
    assert.equal(initials("Mock USD token"), "MU");
    assert.equal(initials("chog"), "C");
    assert.equal(initials("  "), "");
  });
});

describe("toClubInfo", () => {
  it("describes the Club from the assets list", () => {
    const [entry] = parseAssets([
      { chainId: 10143, address: NFT, kind: "erc721", name: "Mock Chog", symbol: "MCHOG", status: "verified", note: "Ours.", club: "archived" },
    ]);
    assert.deepEqual(toClubInfo(entry!), { token: NFT.toLowerCase(), name: "Mock Chog", symbol: "MCHOG", kind: "erc721", archived: true, note: "Ours." });
  });
});

describe("deal token helpers", () => {
  const asset = (kind: "erc721" | "erc20" | "native" | "trait", token: Address) => ({ kind, token, id: 1n, amount: 1n });
  const deal = (offered: DealV2["offered"], requested: DealV2["requested"]) => ({ offered, requested });

  it("tells giving from asking, in any case", () => {
    const d = deal([asset("erc721", NFT)], [asset("erc20", USD)]);
    assert.ok(offersToken(d, NFT.toLowerCase()) && !requestsToken(d, NFT));
    assert.ok(requestsToken(d, USD) && !offersToken(d, USD));
    assert.ok(involvesToken(d, NFT) && involvesToken(d, USD) && !involvesToken(d, OTHER));
  });

  it("counts a trait request for the collection as asking for it", () => {
    assert.ok(requestsToken(deal([asset("erc20", USD)], [asset("trait", NFT)]), NFT));
  });

  it("never matches native MON", () => {
    assert.ok(!involvesToken(deal([asset("native", "0x0000000000000000000000000000000000000000")], []), "0x0000000000000000000000000000000000000000"));
  });
});

describe("Club data", () => {
  let store: Store;
  const [entry] = parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "Mock Chog", symbol: "MCHOG", status: "verified", note: "Ours." }]);
  const log = (e: ActivityEvent) => store.rank(activityKey(NFT), [{ member: JSON.stringify(e), score: e.at }], 100);
  beforeEach(() => {
    store = memoryStore();
  });

  it("reads the log and the pool together", async () => {
    await log(swap({ id: "log:0", at: NOW - 5 }));
    const events = await clubEvents(store, entry!, {
      settlements: async () => [
        { txHash: "0x02", blockNumber: 1, at: (NOW - 1) * 1000, cycle: [{ intent: { maker: alice, give: [{ kind: "erc721", token: NFT, id: 1n, amount: 1n }], want: [] } }, { intent: { maker: bob, give: [], want: [{ kind: "erc721", token: NFT, id: 1n, amount: 1n }] } }] },
      ] as unknown as Settlement[],
    });
    assert.deepEqual(events.map((e) => e.id), ["0x02:settled", "log:0"]);
  });

  it("still serves the log when the pool is down, and the pool when there is no store", async () => {
    await log(swap({ id: "log:0" }));
    const down = async () => {
      throw new Error("unreachable");
    };
    assert.equal((await clubEvents(store, entry!, { settlements: down })).length, 1);
    const pool = async () => [{ txHash: "0x03", blockNumber: 1, at: NOW * 1000, cycle: [{ intent: { maker: alice, give: [{ kind: "erc721", token: NFT }], want: [] } }, { intent: { maker: bob, give: [], want: [{ kind: "erc721", token: NFT }] } }] }] as unknown as Settlement[];
    assert.equal((await clubEvents(null, entry!, { settlements: pool })).length, 1);
    assert.deepEqual(await clubEvents(null, entry!, { settlements: down }), []);
  });

  it("builds a Club's detail: stats and the latest completed swaps", async () => {
    await log(swap({ id: "s1:0", at: NOW - 100 }));
    await log(created({ id: "c1:0", at: NOW - 50 }));
    const { club, recent } = await clubDetail(store, entry!, { now: () => NOW, settlements: async () => [] });
    assert.equal(club.symbol, "MCHOG");
    assert.equal(club.stats.completed7d, 1);
    assert.equal(club.stats.created7d, 1);
    assert.deepEqual(recent.map((e) => e.id), ["s1:0"]);
  });

  it("lists Clubs busiest first, and keeps list order for ties", async () => {
    const entries = parseAssets([
      { chainId: 10143, address: NFT, kind: "erc721", name: "Quiet", symbol: "Q", status: "verified", note: "x" },
      { chainId: 10143, address: USD, kind: "erc20", category: "memecoin", name: "Busy", symbol: "B", status: "verified", note: "x" },
      { chainId: 10143, address: OTHER, kind: "erc20", category: "memecoin", name: "Quiet too", symbol: "Q2", status: "verified", note: "x" },
    ]);
    await store.rank(activityKey(USD), [{ member: JSON.stringify(swap({ id: "u:0", tokens: [USD.toLowerCase()] })), score: NOW }], 10);
    const rows = await clubList(store, entries, { now: () => NOW, settlements: async () => [] });
    assert.deepEqual(rows.map((r) => r.symbol), ["B", "Q", "Q2"]);
    assert.equal(makeRegistry(entries).clubs(10143).length, 3);
  });
});

describe("heat", () => {
  it("puts Momentum into words", () => {
    assert.deepEqual(heat(0), { level: 0, label: "Quiet" });
    assert.equal(heat(0.4).label, "Quiet");
    assert.equal(heat(1).label, "Stirring");
    assert.equal(heat(10).label, "Active", "one fresh swap");
    assert.equal(heat(30).label, "Busy");
    assert.deepEqual(heat(500), { level: 4, label: "Hot" });
  });
});
