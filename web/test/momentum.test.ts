import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOMENTUM, memberScore, score, trend, type ScoredEvent } from "../lib/momentum";

const DAY = 86_400;
const NOW = 1_800_000_000;
const alice = "0xaaaa000000000000000000000000000000000001";
const bob = "0xbbbb000000000000000000000000000000000002";
const carol = "0xcccc000000000000000000000000000000000003";
const dave = "0xdddd000000000000000000000000000000000004";

const swap = (a: string, b: string, ageDays = 0): ScoredEvent => ({ kind: "swapped", at: NOW - ageDays * DAY, parties: [a, b] });
const created = (a: string, ageDays = 0, offsetSec = 0): ScoredEvent => ({ kind: "created", at: NOW - ageDays * DAY + offsetSec, parties: [a] });

describe("constants", () => {
  it("match docs/09-clubs.md, so a tuning change is a deliberate one", () => {
    assert.deepEqual({ ...MOMENTUM }, {
      halfLifeDays: 7,
      windowDays: 30,
      swapWeight: 10,
      createdWeight: 2,
      createdPerDay: 3,
      washFactor: 0.5,
      washDays: 7,
      breadthDivisor: 4,
      xShareWeight: 3,
      postWeight: 4,
    });
  });
});

describe("score", () => {
  it("is zero with nothing logged", () => {
    const s = score([], NOW);
    assert.equal(s.club, 0);
    assert.equal(s.uniqueWallets, 0);
  });

  it("pays each side of a swap, scaled by how many wallets are involved", () => {
    const s = score([swap(alice, bob)], NOW);
    assert.equal(s.wallets.get(alice), MOMENTUM.swapWeight);
    assert.equal(s.wallets.get(bob), MOMENTUM.swapWeight);
    // 20 × (1 + log2(2)) / 4
    assert.equal(s.club, 10);
    assert.equal(s.uniqueWallets, 2);
  });

  it("halves an event's weight every half-life", () => {
    const s = score([swap(alice, bob, MOMENTUM.halfLifeDays)], NOW);
    assert.equal(s.wallets.get(alice), MOMENTUM.swapWeight / 2);
  });

  it("ignores events outside the window and in the future", () => {
    const s = score([swap(alice, bob, MOMENTUM.windowDays + 1), { ...swap(carol, dave), at: NOW + 60 }], NOW);
    assert.equal(s.club, 0);
    assert.equal(s.uniqueWallets, 0);
  });

  it("scores filling your own deal as nothing", () => {
    const s = score([swap(alice, alice), swap(alice, alice.toUpperCase().replace("0X", "0x"))], NOW);
    assert.equal(s.club, 0);
    assert.equal(s.wallets.size, 0);
  });

  it("halves a swap between a pair that just swapped", () => {
    const s = score([swap(alice, bob), swap(bob, alice)], NOW);
    // 10 for the first swap, half of 10 for the repeat.
    assert.equal(s.wallets.get(alice), 15);
    assert.equal(s.wallets.get(bob), 15);
  });

  it("counts a repeat pair in full once the wash window has passed", () => {
    const s = score([swap(alice, bob, MOMENTUM.washDays + 2), swap(alice, bob, 0)], NOW);
    const old = MOMENTUM.swapWeight * 0.5 ** ((MOMENTUM.washDays + 2) / MOMENTUM.halfLifeDays);
    assert.equal(s.wallets.get(alice), Math.round((old + MOMENTUM.swapWeight) * 100) / 100);
  });

  it("pays every side of a ring in full, and damps a ring where any two sides swapped recently", () => {
    const ring: ScoredEvent = { kind: "swapped", at: NOW, parties: [alice, carol, dave] };
    const fresh = score([ring], NOW);
    assert.deepEqual([...fresh.wallets.values()], [10, 10, 10]);
    const repeat = score([swap(alice, bob), { ...ring, parties: [alice, carol, bob] }], NOW);
    assert.equal(repeat.wallets.get(carol), 5);
    assert.equal(repeat.wallets.get(alice), 15);
  });

  it("does not damp a different pair", () => {
    const s = score([swap(alice, bob), swap(alice, carol)], NOW);
    assert.equal(s.wallets.get(alice), 20);
  });

  it("caps a wallet's creations per day", () => {
    const flood = Array.from({ length: 10 }, (_, i) => created(alice, 0, -i));
    const s = score(flood, NOW);
    assert.equal(s.wallets.get(alice), 6);
  });

  it("starts a new cap each day", () => {
    const s = score([...Array.from({ length: 5 }, (_, i) => created(alice, 0, -i)), ...Array.from({ length: 5 }, (_, i) => created(alice, 2, -i))], NOW);
    const cap = MOMENTUM.createdPerDay * MOMENTUM.createdWeight;
    assert.ok(s.wallets.get(alice)! > cap && s.wallets.get(alice)! < cap * 2 + 0.01);
  });

  it("rewards breadth: the same activity from more wallets scores more", () => {
    const one = score([created(alice), created(alice, 0, -1)], NOW);
    const four = score([created(alice), created(bob), created(carol), created(dave)], NOW);
    assert.equal(one.uniqueWallets, 1);
    assert.equal(four.uniqueWallets, 4);
    assert.ok(four.club > one.club);
    // 4 wallets: factor (1 + 2) / 4
    assert.equal(four.club, Math.round(4 * MOMENTUM.createdWeight * 0.75 * 100) / 100);
  });

  it("pays a Board post a little more than an X share, without widening breadth", () => {
    const scores = score([{ kind: "post", at: NOW, parties: [alice] }, { kind: "xshare", at: NOW, parties: [bob] }], NOW);
    assert.equal(memberScore(scores, [alice]), MOMENTUM.postWeight);
    assert.ok(MOMENTUM.postWeight > MOMENTUM.xShareWeight);
    assert.equal(scores.uniqueWallets, 0);
  });

  it("treats wallets case-insensitively", () => {
    const s = score([created(alice), created(alice.toUpperCase().replace("0X", "0x"), 0, -5)], NOW);
    assert.equal(s.uniqueWallets, 1);
  });

  it("does not depend on the order events arrive in", () => {
    const events = [swap(alice, bob, 3), swap(bob, alice, 1), created(carol, 2), swap(carol, dave, 0)];
    const a = score(events, NOW);
    const b = score([...events].reverse(), NOW);
    assert.equal(a.club, b.club);
    assert.deepEqual([...a.wallets], [...b.wallets].sort((x, y) => [...a.wallets.keys()].indexOf(x[0]) - [...a.wallets.keys()].indexOf(y[0])));
  });
});

describe("trend", () => {
  it("compares now with a week ago, ignoring what happened since", () => {
    const events = [swap(alice, bob, 10), swap(carol, dave, 1)];
    const t = trend(events, NOW);
    assert.equal(t.previous, score([events[0]!], NOW - MOMENTUM.halfLifeDays * DAY).club);
    assert.equal(t.score, score(events, NOW).club);
    assert.equal(t.change, Math.round((t.score - t.previous) * 100) / 100);
    assert.ok(t.change !== 0);
  });

  it("is flat for a Club with no history", () => {
    assert.deepEqual(trend([], NOW), { score: 0, previous: 0, change: 0 });
  });
});

describe("memberScore", () => {
  it("sums a member's linked wallets", () => {
    const s = score([swap(alice, bob), swap(carol, bob)], NOW);
    assert.equal(memberScore(s, [alice, carol.toUpperCase().replace("0X", "0x")]), 20);
    assert.equal(memberScore(s, [bob]), 20);
    assert.equal(memberScore(s, ["0x0000000000000000000000000000000000000009"]), 0);
  });
});
