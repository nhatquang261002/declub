import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../lib/clubs";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { activityKey } from "../lib/server/activity";
import { listSystem } from "../lib/server/system";
import { joinClub } from "../lib/server/members";
import { memoryStore } from "../lib/server/store";
import { newest, SYSTEM_MAX, SYSTEM_WINDOW_SEC, weave, type SystemEvent } from "../lib/systemFeed";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NOW = 1_800_000_000;
const A = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const registry = makeRegistry(parseAssets([{ chainId: 10143, address: A, kind: "erc721", name: "A", symbol: "A", status: "verified", note: "Why." }]));
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const event = (id: string, at: number, kind: SystemEvent["kind"] = "swap"): SystemEvent => ({ id, kind, at, wallets: [wallet(1)] });
/** A post made at `at` seconds (the posts' own clock is milliseconds). */
const post = (id: string, at: number, pinned = false) => ({ id, at: at * 1000, pinned });
/** The feed as ids, a run of system messages between two posts as one bracketed group. */
const order = (items: ReturnType<typeof weave<ReturnType<typeof post>>>) => items.map((i) => (i.type === "post" ? i.post.id : `[${i.events.map((e) => e.id).join(" ")}]`));

describe("newest", () => {
  it("keeps the window, newest first, and says it is complete from the window's start", () => {
    const r = newest([event("old", NOW - SYSTEM_WINDOW_SEC - 1), event("a", NOW - 10), event("b", NOW - 5), event("future", NOW + 9)], NOW);
    assert.deepEqual(r.events.map((e) => e.id), ["b", "a"]);
    assert.equal(r.since, NOW - SYSTEM_WINDOW_SEC);
  });

  it("when it cuts the list, is complete only from where it cut", () => {
    const many = Array.from({ length: SYSTEM_MAX + 5 }, (_, i) => event(`e${i}`, NOW - 100 - i));
    const r = newest(many, NOW);
    assert.equal(r.events.length, SYSTEM_MAX);
    assert.equal(r.since, r.events.at(-1)!.at);
  });
});

describe("weave", () => {
  const since = 0;
  it("sets each message among the posts by time", () => {
    const items = weave([post("p3", 300), post("p2", 200), post("p1", 100)], [event("e250", 250), event("e150", 150)], { since, complete: true });
    assert.deepEqual(order(items), ["p3", "[e250]", "p2", "[e150]", "p1"]);
  });

  it("puts messages newer than every post first, and older ones last when the posts are all loaded", () => {
    const items = weave([post("p2", 200), post("p1", 100)], [event("new", 400), event("old", 50)], { since, complete: true });
    assert.deepEqual(order(items), ["[new]", "p2", "p1", "[old]"]);
  });

  it("holds back what is older than the oldest post while more posts are to come", () => {
    const items = weave([post("p2", 200), post("p1", 100)], [event("e150", 150), event("e50", 50)], { since, complete: false });
    assert.deepEqual(order(items), ["p2", "[e150]", "p1"]);
  });

  it("leaves out what is older than the messages are complete from", () => {
    const items = weave([post("p1", 100)], [event("e300", 300), event("e150", 150)], { since: 200, complete: true });
    assert.deepEqual(order(items), ["[e300]", "p1"]);
  });

  it("puts the messages between two posts in one group, newest first", () => {
    const items = weave([post("p2", 500), post("p1", 100)], [event("a", 200), event("b", 400), event("c", 300), event("top", 600)], { since, complete: true });
    assert.deepEqual(order(items), ["[top]", "p2", "[b c a]", "p1"]);
  });

  it("keeps pinned posts on top, and doesn't let an old pin set the floor", () => {
    const items = weave([post("pin", 10, true), post("p2", 200), post("p1", 100)], [event("e150", 150), event("e50", 50)], { since, complete: false });
    assert.deepEqual(order(items), ["pin", "p2", "[e150]", "p1"]);
  });

  it("shows nothing before any unpinned post has loaded, while more are to come", () => {
    assert.deepEqual(order(weave([], [event("e", 100)], { since, complete: false })), []);
    assert.deepEqual(order(weave([], [event("e", 100)], { since, complete: true })), ["[e]"]);
  });
});

describe("listSystem", () => {
  const deps = { now: () => NOW, settlements: async () => [] };
  const logged = (id: string, kind: ActivityEvent["kind"], at: number, parties: string[]): ActivityEvent => ({ id, kind, contract: "0xc", deal: id.split(":")[0]!, block: 1, at, parties, tokens: [A.toLowerCase()] });

  it("lists swaps, listings and joins of the Club, newest first, and not X shares", async () => {
    const store = memoryStore();
    const rows = [
      logged("1:0", "swapped", NOW - 300, [wallet(1), wallet(2)]),
      logged("2:0", "created", NOW - 200, [wallet(3)]),
      logged("x:9", "xshare", NOW - 100, [wallet(4)]),
      logged("3:0", "swapped", NOW - SYSTEM_WINDOW_SEC - 50, [wallet(1), wallet(2)]),
      logged("abc:settled", "swapped", NOW - 400, [wallet(5), wallet(6)]),
    ];
    await store.rank(activityKey(A), rows.map((e) => ({ member: JSON.stringify(e), score: e.at })), 100);
    const w = wallet(7);
    await store.set(profileKey(w), { provider: "twitter", handle: "h7", userId: "u7", updatedAt: 1 });
    await store.setMembers(userWalletsKey("u7"), [w]);
    assert.ok((await joinClub(store, registry.clubFor(A)!, "u7", [w], { holdings: async () => [0n], now: () => (NOW - 250) * 1000 })).ok);

    const r = await listSystem(store, registry.clubFor(A)!, deps);
    assert.deepEqual(r.events.map((e) => [e.id, e.kind]), [
      ["2:0", "listing"],
      [`join:${w}`, "join"],
      ["1:0", "swap"],
      ["abc:settled", "swap"],
    ]);
    assert.deepEqual(r.events[0]!.wallets, [wallet(3)]);
    assert.equal(r.events.find((e) => e.id === "abc:settled")!.signed, true);
    assert.equal(r.events.find((e) => e.id === "1:0")!.signed, undefined);
    assert.equal(r.since, NOW - SYSTEM_WINDOW_SEC);
  });

  it("is empty for a Club with nothing logged", async () => {
    assert.deepEqual((await listSystem(memoryStore(), registry.clubFor(A)!, deps)).events, []);
  });
});
