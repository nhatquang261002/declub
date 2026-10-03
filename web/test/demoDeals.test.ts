import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { ON_DEAL_ADDRESS } from "../lib/config";
import {
  demoDeals,
  demoDealsV2,
  demoDealV2,
  demoIntents,
  demoProposals,
  demoSettlements,
  isDemoDealId,
  isDemoWrite,
} from "../lib/demoDeals";
import { isOpenOffer } from "../lib/dealsV2";
import { ringLegs } from "../lib/intents";

const ME = getAddress("0x00000000000000000000000000000000000000a1");

describe("mock deals", () => {
  it("never shares an id between v1 and V2, so one detail page can't show the other's deal", () => {
    const ids = [...demoDeals().map((d) => d.id), ...demoDealsV2().map((d) => d.id)];
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id >= 9000n), "mock ids stay clear of real testnet ids");
    assert.ok(ids.every(isDemoDealId));
    assert.equal(isDemoDealId(1n), false);
  });

  it("casts the connected wallet as maker and taker, so both views can be seen", () => {
    const v1 = demoDeals(ME);
    const v2 = demoDealsV2(ME);
    assert.ok(v1.some((d) => d.maker === ME) && v1.some((d) => d.taker === ME));
    assert.ok(v2.some((d) => d.maker === ME && d.status === "open") && v2.some((d) => d.taker === ME));
  });

  it("covers every status, including one past its expiry", () => {
    const now = Math.floor(Date.now() / 1000);
    for (const deals of [demoDeals(), demoDealsV2()]) {
      const statuses = new Set<string>(deals.map((d) => d.status));
      for (const status of ["open", "filled", "cancelled"]) assert.ok(statuses.has(status), status);
      assert.ok(deals.some((d) => d.status === "open" && d.expiry !== 0n && d.expiry < BigInt(now)), "an expired deal");
    }
  });

  it("gives open offers a note and offers in every state", () => {
    const open = demoDealsV2().filter(isOpenOffer);
    assert.ok(open.length > 0);
    for (const deal of open) assert.ok(demoDealV2(deal.id)?.note, `note on #${deal.id}`);
    const statuses = new Set(open.flatMap((d) => demoProposals(d.id).map((p) => p.status)));
    for (const status of ["active", "rejected", "withdrawn"]) assert.ok(statuses.has(status as never), status);
  });

  it("settles rings where each maker gets what they asked for", () => {
    const settlements = demoSettlements();
    assert.ok(settlements.some((s) => s.cycle.length > 2), "a ring of three or more");
    for (const { cycle } of settlements) {
      for (const leg of ringLegs(cycle)) {
        for (const want of leg.row.intent.want) {
          const got = leg.received.find((a) => a.kind === want.kind && a.token === want.token && a.id === want.id);
          assert.ok(got && got.amount >= want.amount, `${leg.row.hash} receives its want`);
        }
      }
    }
    const hashes = demoIntents().map((r) => r.hash);
    assert.equal(new Set(hashes).size, hashes.length);
  });

  it("refuses writes for mock deals and lets real ones through", () => {
    assert.equal(isDemoWrite({ address: ON_DEAL_ADDRESS, args: [9012n] }), true);
    assert.equal(isDemoWrite({ address: ON_DEAL_ADDRESS, args: [3n] }), false);
    // An unset contract (V2 mocked without a deployment) has nowhere to send to.
    assert.equal(isDemoWrite({ address: undefined, args: [3n] }), true);
  });
});
