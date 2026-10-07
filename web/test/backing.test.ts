import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoredPost } from "../lib/clubPosts";
import { profileKey, userWalletsKey, type StoredProfile } from "../lib/profiles";
import { REWARDS, backingPoints, voiceOf, type BackingAction, type Voice } from "../lib/rewards";
import { activeDays, dayOf } from "../lib/server/activeDays";
import { backingKey, givenEverywhere, readBacking, verifiedSince } from "../lib/server/backing";
import { createPost, createReply, likePost, postKey, type Deps } from "../lib/server/board";
import { joinClub } from "../lib/server/members";
import { holderInputs, verifiedBy } from "../lib/server/rewards";
import { syncProfile } from "../lib/server/profileSync";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const NFT2 = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const reg = makeRegistry(
  parseAssets([
    { chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." },
    { chainId: 10143, address: NFT2, kind: "erc721", name: "O", symbol: "O", status: "verified", note: "Why." },
  ]),
);
const club = reg.clubFor(NFT)!;
const other = reg.clubFor(NFT2)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const GENESIS = 1_700_000_000;
const WEEK = 7 * 86_400;
const DAY = 86_400;
/** The Board's clock and epochs, `s` seconds into epoch 0. */
const at = (s: number): Deps => ({ now: () => (GENESIS + s) * 1000, epochs: { genesis: GENESIS, length: WEEK } });
const day = (s: number) => String(dayOf(GENESIS + s));

/** A member with a shared profile (a verified account, linked long ago) unless `profile` is false. */
async function member(store: Store, userId: string, n: number, entry = club, profile = true) {
  const w = wallet(n);
  if (profile) await store.set(profileKey(w), { provider: "twitter", handle: `h${n}`, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [w]);
  assert.ok((await joinClub(store, entry, userId, [w], { holdings: async () => [1n] })).ok);
}
/** The cooldowns use the real clock; a test that writes more than once clears them. */
const reset = (store: Store, userId: string, entry = club) =>
  store.del(...["club-post-cd", "club-post-hr", "club-reply-cd", "club-reply-hr"].map((k) => `declub:rl:${k}:${entry.address.toLowerCase()}:${userId}`));
async function post(store: Store, userId: string, s: number, entry = club) {
  await reset(store, userId, entry);
  const r = await createPost(store, entry, userId, { kind: "note", text: "gm" }, at(s));
  assert.ok(r.ok, JSON.stringify(r));
  return r.post.id;
}
async function reply(store: Store, userId: string, parent: string, s: number) {
  await reset(store, userId);
  const r = await createReply(store, club, userId, parent, { text: "welcome" }, at(s));
  assert.ok(r.ok, JSON.stringify(r));
  return r.post.id;
}
const sorted = (actions: BackingAction[]) => [...actions].sort((a, b) => `${a.giver}${a.receiver}${a.kind}`.localeCompare(`${b.giver}${b.receiver}${b.kind}`));

/** A giver's voices: their NFT voice in this Club, and a base voice shared over `given` weight everywhere. */
const v = (club: number, base = 0, given?: number): Voice => ({ club, base, ...(given !== undefined ? { given } : {}) });

describe("backing points (ADR 0038)", () => {
  it("works the ADR's example: voices shared by weight, the first reply weighs most, mutual backing halved", () => {
    const voices = new Map([
      ["A", v(voiceOf(4n))],
      ["B", v(voiceOf(4n))],
      ["C", v(voiceOf(2n))],
      ["D", v(voiceOf(1n))],
    ]);
    const actions: BackingAction[] = [
      { giver: "A", receiver: "B", kind: "like" },
      { giver: "A", receiver: "C", kind: "first" },
      { giver: "B", receiver: "A", kind: "like" },
      { giver: "D", receiver: "A", kind: "like" },
      { giver: "D", receiver: "C", kind: "like" },
    ];
    assert.deepEqual(Object.fromEntries(backingPoints(actions, voices)), {
      A: { points: 25, backers: 2, base: 0 },
      B: { points: 4, backers: 1, base: 0 },
      C: { points: 37, backers: 2, base: 0 },
    });
  });

  it("caps an NFT voice at 5 NFTs, and nobody backs themselves", () => {
    assert.equal(voiceOf(100n), REWARDS.voicePerNft * REWARDS.voiceCapNfts);
    assert.equal(voiceOf(0n), 0);
    const out = backingPoints(
      [
        { giver: "whale", receiver: "x", kind: "like" },
        { giver: "whale", receiver: "whale", kind: "reply" },
        { giver: "nobody", receiver: "x", kind: "reply" },
        // A like back from someone with no voice trades nothing, so it doesn't halve the whale's backing.
        { giver: "x", receiver: "whale", kind: "like" },
      ],
      new Map([["whale", v(voiceOf(100n))]]),
    );
    assert.deepEqual(Object.fromEntries(out), { x: { points: 50, backers: 1, base: 0 } }, "a reply to oneself takes no share of the voice");
  });

  it("spreads a voice thin over many likes", () => {
    const actions = Array.from({ length: 50 }, (_, i): BackingAction => ({ giver: "g", receiver: `r${i}`, kind: "like" }));
    const out = backingPoints(actions, new Map([["g", v(voiceOf(1n))]]));
    assert.equal(out.get("r0")!.points, REWARDS.voicePerNft / 50);
  });
});

describe("base voices (ADR 0039)", () => {
  it("lets a verified account without NFTs back anyone, shared over every Club it gave in", () => {
    const like: BackingAction[] = [{ giver: "fan", receiver: "x", kind: "like" }];
    assert.deepEqual(backingPoints(like, new Map([["fan", v(0, REWARDS.baseVoice)]])).get("x"), { points: REWARDS.baseVoice, backers: 1, base: REWARDS.baseVoice });
    // The same like is one of four the fan gave this week across Clubs: a quarter of the voice.
    assert.equal(backingPoints(like, new Map([["fan", v(0, REWARDS.baseVoice, 4)]])).get("x")!.points, REWARDS.baseVoice / 4);
  });

  it("adds a Holder's base voice to their NFT voice in their own Club", () => {
    const out = backingPoints([{ giver: "h", receiver: "x", kind: "like" }], new Map([["h", v(voiceOf(2n), REWARDS.baseVoice)]]));
    assert.deepEqual(out.get("x"), { points: voiceOf(2n) + REWARDS.baseVoice, backers: 1, base: REWARDS.baseVoice });
  });

  it("caps what base voices give one member, so outsiders can lift a member but not decide the race", () => {
    const fans = Array.from({ length: 6 }, (_, i) => `fan${i}`);
    const out = backingPoints(
      [...fans.map((giver): BackingAction => ({ giver, receiver: "x", kind: "reply" })), { giver: "h", receiver: "x", kind: "like" }],
      new Map<string, Voice>([...fans.map((f) => [f, v(0, REWARDS.baseVoice)] as const), ["h", v(voiceOf(1n))]]),
    );
    assert.deepEqual(out.get("x"), { points: voiceOf(1n) + REWARDS.baseCapPerReceiver, backers: 7, base: REWARDS.baseCapPerReceiver });
  });

  it("halves base backing between two verified accounts that back each other", () => {
    const voices = new Map([
      ["a", v(0, REWARDS.baseVoice)],
      ["b", v(0, REWARDS.baseVoice)],
    ]);
    const out = backingPoints(
      [
        { giver: "a", receiver: "b", kind: "like" },
        { giver: "b", receiver: "a", kind: "like" },
      ],
      voices,
    );
    assert.equal(out.get("a")!.points, REWARDS.baseVoice * REWARDS.mutualFactor);
  });
});

describe("recording backing", () => {
  it("records likes and replies against their epoch, and reads only what still stands", async () => {
    const store = memoryStore();
    for (const [u, n] of [
      ["m1", 1],
      ["m2", 2],
      ["m3", 3],
      ["m4", 4],
    ] as const)
      await member(store, u, n);
    const p = await post(store, "m1", 60);
    assert.ok((await likePost(store, club, "m2", p, true, at(DAY + 60))).ok);
    const first = await reply(store, "m3", p, 2 * DAY + 60);
    await reply(store, "m2", p, 2 * DAY + 120);
    await reply(store, "m1", p, 2 * DAY + 180);
    await likePost(store, club, "m4", p, true, at(3 * DAY));
    await likePost(store, club, "m4", p, false, at(3 * DAY + 10));

    const read = await readBacking(store, token, 0);
    assert.deepEqual(
      sorted(read.actions),
      sorted([
        { giver: "m2", receiver: "m1", kind: "like" },
        { giver: "m3", receiver: "m1", kind: "first" },
        { giver: "m2", receiver: "m1", kind: "reply" },
        { giver: "m1", receiver: "m1", kind: "reply" },
      ]),
      "the like taken back is gone; the author's own reply is there for their day, and carries nothing",
    );
    assert.deepEqual(Object.fromEntries([...read.days].map(([u, d]) => [u, [...d].sort()])), {
      m1: [day(2 * DAY)],
      m2: [day(DAY), day(2 * DAY)],
      m3: [day(2 * DAY)],
    });
    assert.deepEqual(Object.fromEntries(await activeDays(store, token, 0, read.days)), { m1: 2, m2: 2, m3: 1 }, "a post, a like or a reply makes a day active");

    // A moderator hiding the first reply hands "first" to the next one; hiding the post takes the whole thread out.
    const firstPost = (await store.get<StoredPost>(postKey(token, first)))!;
    await store.set(postKey(token, first), { ...firstPost, hidden: "moderator" });
    const afterFirst = await readBacking(store, token, 0);
    assert.ok(afterFirst.actions.some((a) => a.giver === "m2" && a.kind === "first"));
    assert.deepEqual(afterFirst.removed, [{ giver: "m3", receiver: "m1", kind: "reply" }], "what the hide took out is kept, for publishing");
    const parent = (await store.get<StoredPost>(postKey(token, p)))!;
    await store.set(postKey(token, p), { ...parent, hidden: "moderator" });
    const hiddenPost = await readBacking(store, token, 0);
    assert.deepEqual(hiddenPost.actions, []);
    assert.equal(hiddenPost.removed.length, 4, "the like and the three replies (one is the author's own) go with the post");
    assert.deepEqual([...hiddenPost.days], [], "and make no active day");
    assert.equal((await store.members(backingKey(token, 1))).length, 0, "nothing was given in epoch 1");
  });

  it("is not removed by reports: a post they hid (before ADR 0040) still counts until a moderator acts", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    await member(store, "m2", 2);
    const p = await post(store, "m1", 60);
    await likePost(store, club, "m2", p, true, at(120));
    const stored = (await store.get<StoredPost>(postKey(token, p)))!;
    await store.set(postKey(token, p), { ...stored, reported: true, hidden: "reports" });
    const read = await readBacking(store, token, 0);
    assert.deepEqual(read.actions, [{ giver: "m2", receiver: "m1", kind: "like" }]);
    assert.deepEqual(read.removed, []);
    await store.set(postKey(token, p), { ...stored, hidden: "moderator" });
    assert.deepEqual((await readBacking(store, token, 0)).actions, [], "a moderator's hide does");
  });

  it("doesn't let a like taken back and given again add a day (ADR 0040)", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    await member(store, "m2", 2);
    const p = await post(store, "m1", 60);
    assert.ok((await likePost(store, club, "m2", p, true, at(DAY + 60))).ok);
    assert.ok((await likePost(store, club, "m2", p, false, at(DAY + 120))).ok);
    assert.ok((await likePost(store, club, "m2", p, true, at(3 * DAY + 60))).ok);
    assert.ok((await likePost(store, club, "m2", p, false, at(3 * DAY + 120))).ok);
    assert.ok((await likePost(store, club, "m2", p, true, at(5 * DAY + 60))).ok);
    const read = await readBacking(store, token, 0);
    assert.deepEqual(read.actions, [{ giver: "m2", receiver: "m1", kind: "like" }], "still one like");
    assert.deepEqual([...read.days.get("m2")!], [day(DAY)], "counted on its first day only: three likes, one day");
  });

  it("turns backing into Holders' points, with NFT voices from the balance read and base voices from verified profiles", async () => {
    const store = memoryStore();
    for (const [u, n] of [
      ["m1", 1],
      ["m2", 2],
      ["m3", 3],
    ] as const)
      await member(store, u, n);
    const held: Record<string, bigint> = { [wallet(1)]: 1n, [wallet(2)]: 3n, [wallet(3)]: 2n };
    const holdings = async (_: string, wallets: readonly string[]) => wallets.map((w) => held[w.toLowerCase()] ?? 0n);
    const p = await post(store, "m1", 60);
    await likePost(store, club, "m2", p, true, at(120));

    const { holders } = await holderInputs(store, club, 0, [], null, holdings, {}, verifiedBy(GENESIS + WEEK));
    const by = Object.fromEntries(holders.map((h) => [h.userId, [h.points, h.backedPoints, h.backers, h.basePoints, h.days]]));
    const backed = 3 * REWARDS.voicePerNft + REWARDS.baseVoice;
    assert.deepEqual(by, {
      m1: [REWARDS.dayPoints + backed, backed, 1, REWARDS.baseVoice, 1],
      m2: [REWARDS.dayPoints, 0, 0, 0, 1],
      m3: [0, 0, 0, 0, 0],
    });
  });

  it("shares a base voice over every Club, and gives none to a profile shared too late or not at all", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    await member(store, "m1b", 5, other);
    await member(store, "fan", 2);
    await member(store, "fan", 2, other);
    await member(store, "late", 3);
    await member(store, "anon", 4, club, false);
    const holdings = async (_: string, wallets: readonly string[]) => wallets.map((w) => (w.toLowerCase() === wallet(1) ? 1n : 0n));
    const p = await post(store, "m1", 60);
    const q = await post(store, "m1b", 60, other);
    await likePost(store, club, "fan", p, true, at(120));
    await likePost(store, other, "fan", q, true, at(130));
    await likePost(store, club, "late", p, true, at(140));
    await likePost(store, club, "anon", p, true, at(150));
    // "late" shared a profile two days before the epoch ends: too recent to give a base voice.
    await store.set(profileKey(wallet(3)), { provider: "twitter", handle: "h3", userId: "late", updatedAt: 1, since: (GENESIS + WEEK - 2 * DAY) * 1000 });

    assert.equal(await givenEverywhere(store, 0, "fan"), 2 * REWARDS.likeWeight);
    const { holders } = await holderInputs(store, club, 0, [], null, holdings, {}, verifiedBy(GENESIS + WEEK));
    const m1 = holders.find((h) => h.userId === "m1")!;
    assert.deepEqual([m1.backedPoints, m1.backers, m1.basePoints], [REWARDS.baseVoice / 2, 1, REWARDS.baseVoice / 2], "half the fan's voice; late and anon give none");
  });
});

describe("when a profile was first shared (ADR 0039)", () => {
  it("is kept across rewrites, and starts again after the share is dropped", async () => {
    const store = memoryStore();
    const accounts = [
      { type: "wallet", chain_type: "ethereum", address: wallet(7) },
      { type: "twitter_oauth", username: "seven" },
    ] as unknown as Parameters<typeof syncProfile>[2];
    assert.equal((await syncProfile(store, "u7", accounts, false)).shared, true);
    const first = (await store.get<StoredProfile>(profileKey(wallet(7))))!;
    await store.set(profileKey(wallet(7)), { ...first, since: 1_000 });
    await syncProfile(store, "u7", accounts, true);
    assert.equal((await store.get<StoredProfile>(profileKey(wallet(7))))!.since, 1_000, "a refresh keeps it");
    assert.equal(await verifiedSince(store, "u7"), 1_000);

    await syncProfile(store, "u7", [accounts[0]!], false);
    assert.equal(await verifiedSince(store, "u7"), null, "no profile, no base voice");
    await syncProfile(store, "u7", accounts, false);
    assert.ok((await verifiedSince(store, "u7"))! > 1_000, "sharing again starts the clock again");
  });
});
