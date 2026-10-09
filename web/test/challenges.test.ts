import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, keccak256, stringToHex, concat, type Hex } from "viem";
import {
  CHALLENGE_CAP_PER_EPOCH,
  CHALLENGE_RULES,
  checkChallenge,
  drawOrder,
  drawSeed,
  drawWinners,
  likesDecide,
  phaseOf,
  prizeText,
  winnersByLikes,
  winnersByPick,
  winnersByTime,
  type StoredChallenge,
} from "../lib/challenges";
import type { ActivityEvent } from "../lib/clubs";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { banUser, createPost, deletePost, getPost, hidePost, likePost, type Deps } from "../lib/server/board";
import { challengesHandlers, challengeHandlers } from "../lib/server/boardRoutes";
import {
  cancelChallenge,
  createChallenge,
  enterChallenge,
  getChallenge,
  listChallenges,
  liveChallenges,
  pickWinners,
  settleDue,
  withdrawEntry,
  type BlockReader,
} from "../lib/server/challenges";
import { challengeKey, challengesKey, entriesKey, entryOfKey, readAwards, votingClosed } from "../lib/server/challengeState";
import { readLog, saveRoles } from "../lib/server/clubState";
import type { UserGate } from "../lib/server/gate";
import { getMember, joinClub, type Holdings } from "../lib/server/members";
import { buildEpoch, closeEpoch, pointsKey, type PublishedLedger, type RewardsDeps } from "../lib/server/rewards";
import { listSystem } from "../lib/server/system";
import { setRewardBan } from "../lib/server/rewardSettings";
import { computeStandings } from "../lib/server/standings";
import { memoryStore, type Store } from "../lib/server/store";
import { momentumPostEvents } from "../lib/server/postMomentum";
import { readXShares, xShareEvents } from "../lib/server/xPosts";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";
import type { XCard } from "../lib/xPosts";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const reg = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." }]));
const club = reg.clubFor(NFT)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const GENESIS = 1_700_000_000;
const WEEK = 7 * 86_400;
const DAY = 86_400;
/** The clock `s` seconds into epoch 0, and the admins. */
/** The X posts members shared, by id: an entry is a member's own X post (`xEntryProblem`). */
const tweets = new Map<string, XCard>();
const at = (s: number): Deps => ({
  now: () => (GENESIS + s) * 1000,
  epochs: { genesis: GENESIS, length: WEEK },
  admins: new Set(["adm"]),
  lookupX: async (id) => tweets.get(id) ?? null,
  // Each member's linked X account is named after their user id.
  xAccountOf: async (userId) => ({ username: userId, subject: userId }),
});
const actor = (userId: string, n: number) => ({ userId, wallet: wallet(n) });

async function member(store: Store, userId: string, n: number) {
  const w = wallet(n);
  await store.set(profileKey(w), { provider: "twitter", handle: `h${n}`, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [w]);
  assert.ok((await joinClub(store, club, userId, [w], { holdings: async () => [0n] })).ok);
}
let tweetId = 1_000;
/**
 * A Board post by `userId` at `s` seconds, sharing an X post: by default their own, posted on X just
 * before. `x: "none"` makes a plain note; "theirs" another account's post; a number, the X post's time.
 */
async function post(store: Store, userId: string, s: number, x: "own" | "none" | "theirs" | number = "own", text = `my entry ${s}`) {
  await store.del(`declub:rl:club-post-cd:${token}:${userId}`, `declub:rl:club-post-hr:${token}:${userId}`);
  const id = String(tweetId++);
  tweets.set(id, { id, author: x === "theirs" ? "someone" : userId, text, postedAt: (GENESIS + (typeof x === "number" ? x : s)) * 1000 });
  const link = x === "none" ? {} : { link: `https://x.com/${userId}/status/${id}` };
  const r = await createPost(store, club, userId, { kind: "note", text: `gm ${userId} ${s}`, ...link }, at(s));
  assert.ok(r.ok);
  return r.post.id;
}
/** An Owner (1), a Moderator (2), Holders g (4 NFTs) and a (2), and x, a member with no NFT. */
async function world() {
  const store = memoryStore();
  for (const [u, n] of [
    ["own", 1],
    ["mod", 2],
    ["g", 3],
    ["a", 4],
    ["x", 5],
  ] as const)
    await member(store, u, n);
  await saveRoles(store, token, { owner: "own", moderators: ["mod"] });
  return store;
}
const input = (over: Record<string, unknown> = {}) => ({
  title: "Best Chog meme",
  brief: "Post your funniest Chog.",
  judging: "likes",
  prizes: [10, 5],
  epochs: 1,
  ...over,
});
const START = 10;
/** A challenge started in epoch 0 ends with it. */
const END = WEEK;

async function start(store: Store, over: Record<string, unknown> = {}, s = START) {
  const r = await createChallenge(store, club, actor("own", 1), input(over), at(s));
  assert.ok(r.ok);
  return r.id;
}

describe("a challenge's rules", () => {
  it("checks what the Owner sends", () => {
    assert.ok(checkChallenge(input()).ok);
    const bad = (over: Record<string, unknown>) => {
      const r = checkChallenge(input(over));
      assert.equal(r.ok, false, JSON.stringify(over));
    };
    bad({ title: "  " });
    bad({ title: "x".repeat(CHALLENGE_RULES.titleMax + 1) });
    bad({ brief: "" });
    bad({ judging: "coin flip" });
    bad({ prizes: [] });
    bad({ prizes: [1, 1, 1, 1] });
    bad({ prizes: [5, 10] });
    bad({ prizes: [CHALLENGE_RULES.maxPoints + 1] });
    bad({ prizes: [2.5] });
    bad({ prizes: [-1] });
    assert.ok(checkChallenge(input({ prizes: [0] })).ok, "a place may pay no points: a trophy only");
    bad({ epochs: 0 });
    bad({ epochs: CHALLENGE_RULES.maxEpochs + 1 });
    bad({ epochs: 1.5 });
    bad({ holdersOnly: "yes" });
    assert.equal(checkChallenge(null).ok, false);
    assert.equal(prizeText([10, 5, 2]), "10, 5 and 2 points");
    assert.equal(prizeText([1]), "1 point");
  });

  it("ranks likes with the earlier entry first on a tie, one place a member", () => {
    const c = (post: string, userId: string, at: number, likes: number) => ({ post, userId, wallet: `w${userId}`, at, likes });
    const winners = winnersByLikes([c("p1", "u1", 5, 2), c("p2", "u2", 3, 2), c("p3", "u3", 1, 0), c("p4", "u1", 9, 9)], [10, 5, 2]);
    assert.deepEqual(
      winners.map((w) => [w.post, w.place, w.points]),
      [
        ["p4", 1, 10],
        ["p2", 2, 5],
      ],
      "p3 has no likes, and u1 wins once",
    );
    assert.deepEqual(
      winnersByLikes([c("p1", "u1", 1, 1)], [10, 5]).map((w) => w.place),
      [1],
      "fewer entries than places",
    );
    const eligible = [c("p1", "u1", 1, 0), c("p2", "u2", 2, 0)];
    assert.equal(winnersByPick(["p2", "p1"], eligible, [3, 1]).ok, true);
    assert.equal(winnersByPick(["p1", "p1"], eligible, [3, 1]).ok, false);
    assert.equal(winnersByPick(["p1", "p2", "p3"], eligible, [3, 1]).ok, false, "more picks than places");
    assert.equal(winnersByPick(["nope"], eligible, [3, 1]).ok, false);
    assert.equal(winnersByPick([], eligible, [3, 1]).ok, false);
  });

  it("has a phase", () => {
    const base = { endsAt: 100, judging: "likes" as const };
    assert.equal(phaseOf({ ...base, state: "live" }, 50), "open");
    assert.equal(phaseOf({ ...base, state: "live" }, 100), "closing");
    assert.equal(phaseOf({ ...base, judging: "owner", state: "live" }, 100), "judging");
    assert.equal(phaseOf({ ...base, state: "settled" }, 500), "settled");
  });
});

describe("starting and calling off a challenge", () => {
  it("is the Owner's (or an admin's), at any time, three open at most", async () => {
    const store = await world();
    for (const who of [actor("mod", 2), actor("a", 4)])
      assert.deepEqual(await createChallenge(store, club, who, input(), at(START)), { ok: false, reason: "forbidden" });
    const bad = await createChallenge(store, club, actor("own", 1), input({ prizes: [] }), at(START));
    assert.equal(bad.ok || bad.reason, "invalid");
    const first = await start(store);
    await start(store, { title: "Second" });
    assert.ok((await createChallenge(store, club, actor("adm", 9), input({ title: "Third" }), at(START))).ok, "an app admin may too");
    const fourth = await createChallenge(store, club, actor("own", 1), input({ title: "Fourth" }), at(START));
    assert.equal(fourth.ok || fourth.reason, "too_many_open");

    const log = await readLog(store, token);
    assert.equal(log.filter((l) => l.action === "create_challenge").length, 3);

    const cancelled = await cancelChallenge(store, club, actor("own", 1), first, at(60));
    assert.ok(cancelled.ok);
    assert.deepEqual(await cancelChallenge(store, club, actor("own", 1), first, at(60)), { ok: false, reason: "closed" });
    assert.deepEqual(await cancelChallenge(store, club, actor("mod", 2), first, at(60)), { ok: false, reason: "forbidden" });
    assert.ok((await createChallenge(store, club, actor("own", 1), input({ title: "Fourth" }), at(70))).ok, "a cancelled one makes room");
    const listed = await listChallenges(store, club, {}, at(80));
    assert.equal(listed.find((c) => c.id === first)!.phase, "cancelled");
  });

  it("can't be started in an archived Club", async () => {
    const store = await world();
    const archived = { ...club, club: "archived" as const };
    assert.deepEqual(await createChallenge(store, archived, actor("own", 1), input(), at(START)), { ok: false, reason: "archived" });
  });
});

describe("a challenge runs in epochs", () => {
  it("ends when an epoch does", async () => {
    const store = await world();
    const one = await start(store);
    const two = await start(store, { epochs: 2 });
    const view = await listChallenges(store, club, {}, at(20));
    assert.equal(view.find((c) => c.id === one)!.endsAt, (GENESIS + WEEK) * 1000);
    assert.equal(view.find((c) => c.id === two)!.endsAt, (GENESIS + 2 * WEEK) * 1000);
    // From the middle of epoch 1, "this epoch" ends with epoch 1.
    const later = await createChallenge(store, club, actor("own", 1), input({ title: "Later", epochs: 1 }), at(WEEK + 100));
    assert.ok(later.ok);
    assert.equal((await listChallenges(store, club, {}, at(WEEK + 101))).find((c) => c.id === later.id)!.endsAt, (GENESIS + 2 * WEEK) * 1000);
  });

  it("can't start with less than an hour left, but can run to the next epoch", async () => {
    const store = await world();
    const short = await createChallenge(store, club, actor("own", 1), input(), at(WEEK - 600));
    assert.equal(short.ok || short.reason, "invalid");
    assert.ok((await createChallenge(store, club, actor("own", 1), input({ epochs: 2 }), at(WEEK - 600))).ok);
  });
});

describe("a challenge for Holders only", () => {
  it("takes entries from Holders, and from nobody else", async () => {
    const store = await world();
    const w = wallet(7);
    await store.set(profileKey(w), { provider: "twitter", handle: "h7", userId: "h", updatedAt: 1 });
    await store.setMembers(userWalletsKey("h"), [w]);
    assert.ok((await joinClub(store, club, "h", [w], { holdings: async () => [1n] })).ok);
    const id = await start(store, { holdersOnly: true });
    assert.equal((await listChallenges(store, club, {}, at(20)))[0]!.holdersOnly, true);
    const mine = await post(store, "h", 60);
    const theirs = await post(store, "a", 61);
    assert.deepEqual(await enterChallenge(store, club, "a", id, theirs, at(62)), { ok: false, reason: "holders_only" });
    assert.ok((await enterChallenge(store, club, "h", id, mine, at(62))).ok);
    // Everyone may like, and an open one takes anyone.
    assert.ok((await likePost(store, club, "a", mine, true, at(63))).ok);
    const open = await start(store, { title: "Open" });
    assert.ok((await enterChallenge(store, club, "a", open, theirs, at(64))).ok);
  });

  it("reads the badge fresh, so an NFT just bought counts and one sold doesn't", async () => {
    const store = await world();
    const w = wallet(8);
    await store.set(profileKey(w), { provider: "twitter", handle: "h8", userId: "b", updatedAt: 1 });
    await store.setMembers(userWalletsKey("b"), [w]);
    assert.ok((await joinClub(store, club, "b", [w], { holdings: async () => [0n], now: () => (GENESIS + 100) * 1000 })).ok);
    const id = await start(store, { holdersOnly: true });
    const entry = await post(store, "b", 120);
    const holding = (n: bigint) => async (_t: string, ws: readonly string[]) => ws.map(() => n);
    // Read less than a minute ago: that answer stands.
    assert.deepEqual(await enterChallenge(store, club, "b", id, entry, { ...at(130), holdings: holding(1n) }), { ok: false, reason: "holders_only" });
    // Later, the chain is read again: they bought one.
    assert.ok((await enterChallenge(store, club, "b", id, entry, { ...at(200), holdings: holding(1n) })).ok);
    assert.equal((await getMember(store, token, "b"))!.holder, true);
    // And sold it: a new entry is refused.
    assert.deepEqual(await enterChallenge(store, club, "b", id, entry, { ...at(300), holdings: holding(0n) }), { ok: false, reason: "holders_only" });
  });
});

describe("entering a challenge", () => {
  it("takes only the member's own X post, posted on X while it runs, and shows its card", async () => {
    const store = await world();
    const id = await start(store);
    const plain = await post(store, "g", 30, "none");
    const theirs = await post(store, "g", 40, "theirs");
    const old = await post(store, "g", 50, START - 5);
    assert.deepEqual(await enterChallenge(store, club, "g", id, plain, at(60)), { ok: false, reason: "not_x" });
    assert.deepEqual(await enterChallenge(store, club, "g", id, theirs, at(60)), { ok: false, reason: "x_not_own" });
    assert.deepEqual(await enterChallenge(store, club, "g", id, old, at(60)), { ok: false, reason: "x_too_old" });
    const good = await post(store, "g", 70);
    assert.ok((await enterChallenge(store, club, "g", id, good, at(80))).ok);
    const shown = (await getChallenge(store, club, id, {}, at(90)))!.entries[0]!;
    assert.equal(shown.x?.author, "g");
    assert.equal(shown.x?.own, true);
  });

  it("takes a member's own post made while it's open, one entry each", async () => {
    const store = await world();
    const early = await post(store, "g", 5);
    const id = await start(store);
    assert.deepEqual(await enterChallenge(store, club, "g", id, early, at(60)), { ok: false, reason: "bad_post" }, "posted before it started");
    const mine = await post(store, "g", 60);
    const theirs = await post(store, "a", 61);
    assert.deepEqual(await enterChallenge(store, club, "g", id, theirs, at(62)), { ok: false, reason: "bad_post" }, "someone else's post");
    assert.deepEqual(await enterChallenge(store, club, "g", id, "nope", at(62)), { ok: false, reason: "bad_post" });
    assert.deepEqual(await enterChallenge(store, club, "ghost", id, mine, at(62)), { ok: false, reason: "not_member" });
    assert.ok((await enterChallenge(store, club, "g", id, mine, at(62))).ok);
    assert.ok((await enterChallenge(store, club, "g", id, mine, at(63))).ok, "again is fine");

    const second = await post(store, "g", 70);
    assert.ok((await enterChallenge(store, club, "g", id, second, at(71))).ok);
    const view = (await listChallenges(store, club, { userId: "g" }, at(72)))[0]!;
    assert.deepEqual(
      view.entries.map((e) => e.post),
      [second],
      "a new entry replaces the old",
    );
    assert.equal(view.mine, second);
    assert.equal(view.entryCount, 1);

    const other = await start(store, { title: "Other" });
    assert.deepEqual(await enterChallenge(store, club, "g", other, second, at(73)), { ok: false, reason: "already_entered" });

    assert.ok((await withdrawEntry(store, club, "g", id, at(74))).ok);
    assert.deepEqual(await withdrawEntry(store, club, "g", id, at(74)), { ok: false, reason: "no_entry" });
    assert.ok((await enterChallenge(store, club, "g", other, second, at(75))).ok, "a withdrawn post is free again");
  });

  it("isn't open to the Owner, or to members banned from rewards, and closes at the end", async () => {
    const store = await world();
    const id = await start(store);
    const owners = await post(store, "own", 60);
    assert.deepEqual(await enterChallenge(store, club, "own", id, owners, at(61)), { ok: false, reason: "owner_entry" });
    const xs = await post(store, "x", 62);
    assert.ok((await setRewardBan(store, club, actor("own", 1), wallet(5), true, at(63))).ok);
    assert.deepEqual(await enterChallenge(store, club, "x", id, xs, at(64)), { ok: false, reason: "reward_banned" });
    const gs = await post(store, "g", 65);
    assert.deepEqual(await enterChallenge(store, club, "g", id, gs, at(END + 1)), { ok: false, reason: "closed" });
    const lateId = await start(store, { title: "Late" }, 100);
    const late = await post(store, "g", 3 * DAY);
    assert.deepEqual(await enterChallenge(store, club, "g", lateId, late, at(3 * DAY + 1)), { ok: true });
  });
});

describe("a Moderator in a challenge", () => {
  it("can enter and win like any member", async () => {
    const store = await world();
    const id = await start(store);
    const m = await post(store, "mod", 60);
    assert.ok((await enterChallenge(store, club, "mod", id, m, at(61))).ok);
    assert.ok((await likePost(store, club, "a", m, true, at(62))).ok);
    const done = (await listChallenges(store, club, {}, at(END + 1)))[0]!;
    assert.deepEqual(
      done.settled!.winners.map((w) => [w.wallet, w.points]),
      [[wallet(2), 10]],
    );
  });

  it("can't hide, delete or ban a rival in a challenge still running, but the Owner can", async () => {
    const store = await world();
    const id = await start(store);
    const m = await post(store, "mod", 60);
    const g = await post(store, "g", 61);
    const other = await post(store, "a", 62);
    assert.ok((await enterChallenge(store, club, "mod", id, m, at(63))).ok);
    assert.ok((await enterChallenge(store, club, "g", id, g, at(63))).ok);
    const mod = actor("mod", 2);
    assert.deepEqual(await hidePost(store, club, mod, g, true, at(70)), { ok: false, reason: "challenge_conflict" });
    assert.deepEqual(await deletePost(store, club, mod, g, at(70)), { ok: false, reason: "challenge_conflict" });
    assert.deepEqual(await banUser(store, club, mod, { post: g }, false, at(70)), { ok: false, reason: "challenge_conflict" });
    // Someone who isn't in it, or a Moderator who didn't enter, is no conflict.
    assert.ok((await hidePost(store, club, mod, other, true, at(71))).ok);
    assert.ok((await hidePost(store, club, actor("own", 1), g, true, at(72))).ok, "the Owner may");
    // Once it's settled, it's over.
    const store2 = await world();
    const id2 = await start(store2);
    const m2 = await post(store2, "mod", 60);
    const g2 = await post(store2, "g", 61);
    for (const [u, p] of [
      ["mod", m2],
      ["g", g2],
    ] as const)
      assert.ok((await enterChallenge(store2, club, u, id2, p, at(63))).ok);
    await listChallenges(store2, club, {}, at(END + 1));
    assert.ok((await hidePost(store2, club, mod, g2, true, at(END + 2))).ok);
  });
});

describe("a challenge judged by likes", () => {
  async function played() {
    const store = await world();
    const id = await start(store);
    const g = await post(store, "g", 60);
    const a = await post(store, "a", 61);
    const x = await post(store, "x", 62);
    for (const [u, p] of [
      ["g", g],
      ["a", a],
      ["x", x],
    ] as const)
      assert.ok((await enterChallenge(store, club, u, id, p, at(63))).ok, u);
    // g: 3 likes, a: 2, x: 0.
    for (const [who, p] of [
      ["a", g],
      ["x", g],
      ["mod", g],
      ["g", a],
      ["x", a],
    ] as const)
      assert.ok((await likePost(store, club, who, p, true, at(100))).ok);
    return { store, id, g, a, x };
  }

  it("pays the most liked, and locks the likes when it ends", async () => {
    const { store, id, g, a, x } = await played();
    const open = (await listChallenges(store, club, {}, at(200)))[0]!;
    assert.equal(open.phase, "open");
    assert.deepEqual(
      open.entries.map((e) => [e.post, e.likes]),
      [
        [g, 3],
        [a, 2],
        [x, 0],
      ],
    );

    // Taking a like back is still fine while it runs.
    assert.ok((await likePost(store, club, "mod", g, false, at(300))).ok);
    assert.ok((await likePost(store, club, "mod", g, true, at(301))).ok);
    // From the end the tally is locked, either way.
    assert.deepEqual(await likePost(store, club, "mod", a, true, at(END)), { ok: false, reason: "voting_closed" });
    assert.deepEqual(await likePost(store, club, "a", g, false, at(END)), { ok: false, reason: "voting_closed" });

    const settled = (await listChallenges(store, club, {}, at(END + 5)))[0]!;
    assert.equal(settled.phase, "settled");
    assert.deepEqual(
      settled.settled!.winners.map((w) => [w.post, w.wallet, w.place, w.points]),
      [
        [g, wallet(3), 1, 10],
        [a, wallet(4), 2, 5],
      ],
    );
    assert.equal(settled.settled!.epoch, 0);
    assert.deepEqual(
      settled.entries.map((e) => e.place),
      [1, 2, undefined],
    );
    assert.equal(await settleDue(store, club, at(END + 10)), 0, "settled once");
    const awards = await readAwards(store, token, 0);
    assert.deepEqual(
      Object.values(awards)
        .map((x) => [x.userId, x.points])
        .sort(),
      [
        ["a", 5],
        ["g", 10],
      ],
    );
    assert.ok((await readLog(store, token)).some((l) => l.action === "settle_challenge" && l.target === id));
  });

  const rewardsDeps = (over: Partial<RewardsDeps> = {}): RewardsDeps => {
    const holdings: Holdings = async (_t, ws) => ws.map((w) => ({ [wallet(1)]: 1n, [wallet(3)]: 4n, [wallet(4)]: 2n })[w.toLowerCase()] ?? 0n);
    const swap: ActivityEvent = {
      id: "0x1:0",
      kind: "swapped",
      contract: "0xswap",
      deal: "1",
      block: 1,
      at: GENESIS + 100,
      parties: [wallet(8), wallet(9)],
      tokens: [token],
      fee: (4n * 10n ** 18n).toString(),
    };
    return {
      now: () => GENESIS + WEEK + 60,
      clubs: [club],
      events: async () => [swap],
      holdings,
      chainId: 10143,
      contract: getAddress(wallet(0xee)),
      genesis: GENESIS,
      length: WEEK,
      ...over,
    };
  };

  it("counts the points in the frozen epoch it ended in, and in the published ledger", async () => {
    const { store } = await played();
    // The close job settles what has ended before it freezes the epoch.
    assert.equal(await settleDue(store, club, at(WEEK + 1)), 1);
    await closeEpoch(store, 0, rewardsDeps());
    const built = await buildEpoch(store, 0, rewardsDeps());
    assert.equal(built.status, "built");
    const ledger = (await store.get<Record<string, PublishedLedger>>(pointsKey(0)))![token]!;
    const row = (w: string) => ledger.rows.find((r) => r.wallet === w)!;
    assert.equal(row(wallet(3)).challengePoints, 10);
    assert.equal(row(wallet(4)).challengePoints, 5);
    assert.ok(row(wallet(3)).points >= 10, "they count as activity points");
    assert.deepEqual(ledger.challenges, {
      cap: CHALLENGE_CAP_PER_EPOCH,
      wins: [
        { challenge: ledger.challenges!.wins[0]!.challenge, title: "Best Chog meme", wallet: wallet(3), place: 1, points: 10 },
        { challenge: ledger.challenges!.wins[0]!.challenge, title: "Best Chog meme", wallet: wallet(4), place: 2, points: 5 },
      ],
    });
  });

  it("counts in the running epoch's standings when the epoch it ended in was already closed", async () => {
    const { store } = await played();
    await closeEpoch(store, 0, rewardsDeps());
    const live = await computeStandings(store, club, rewardsDeps({ now: () => GENESIS + WEEK + 120 }));
    assert.equal(live!.n, 1);
    const g = live!.rows.find((r) => r.wallet === wallet(3))!;
    assert.equal(g.challengePoints, 10);
    assert.ok(g.points >= 10);
    assert.equal((await readAwards(store, token, 0))["g"], undefined);
  });

  it("leaves out a hidden entry, and a member banned from rewards", async () => {
    const { store, id, g, a } = await played();
    assert.ok((await hidePost(store, club, actor("mod", 2), g, true, at(150))).ok);
    assert.ok((await setRewardBan(store, club, actor("own", 1), wallet(4), true, at(151))).ok);
    const settled = (await listChallenges(store, club, {}, at(END + 5))).find((c) => c.id === id)!;
    assert.deepEqual(settled.settled!.winners, [], "g's entry is hidden, a can't win, and x has no likes left");
    assert.equal(
      settled.entries.some((e) => e.post === a),
      false,
    );
  });

  it("has no winner when nobody was liked, and pays nothing", async () => {
    const store = await world();
    const id = await start(store);
    const g = await post(store, "g", 60);
    assert.ok((await enterChallenge(store, club, "g", id, g, at(61))).ok);
    // A like from its own author can't be given at all.
    assert.deepEqual(await likePost(store, club, "g", g, true, at(62)), { ok: false, reason: "own_like" });
    const done = (await listChallenges(store, club, {}, at(END + 1)))[0]!;
    assert.equal(done.phase, "settled");
    assert.deepEqual(done.settled!.winners, []);
    assert.deepEqual(await readAwards(store, token, 0), {});
  });

  it("counts a member's challenge points at most CHALLENGE_CAP_PER_EPOCH in an epoch", async () => {
    const store = await world();
    const ids = [
      await start(store, { prizes: [15], title: "One" }),
      await start(store, { prizes: [15], title: "Two" }),
      await start(store, { prizes: [15], title: "Three" }),
    ];
    for (const [i, id] of ids.entries()) {
      const p = await post(store, "g", 60 + i);
      assert.ok((await enterChallenge(store, club, "g", id, p, at(70))).ok);
      assert.ok((await likePost(store, club, "a", p, true, at(80))).ok);
    }
    await listChallenges(store, club, {}, at(END + 1));
    assert.equal((await readAwards(store, token, 0))["g"]!.points, 45, "the wins are all kept and published");
    const holdings: Holdings = async (_t, ws) => ws.map((w) => ({ [wallet(3)]: 4n, [wallet(4)]: 2n })[w.toLowerCase()] ?? 0n);
    const deps: RewardsDeps = {
      now: () => GENESIS + WEEK + 60,
      clubs: [club],
      events: async () => [],
      holdings,
      chainId: 10143,
      contract: getAddress(wallet(0xee)),
      genesis: GENESIS,
      length: WEEK,
    };
    await closeEpoch(store, 0, deps);
    await buildEpoch(store, 0, deps);
    const ledger = (await store.get<Record<string, PublishedLedger>>(pointsKey(0)))![token]!;
    assert.equal(ledger.rows.find((r) => r.wallet === wallet(3))!.challengePoints, CHALLENGE_CAP_PER_EPOCH);
  });

  it("counts in the epoch it ended in until that epoch is closed, then in the next", async () => {
    const store = await world();
    const id = await start(store);
    const g = await post(store, "g", 60);
    assert.ok((await enterChallenge(store, club, "g", id, g, at(61))).ok);
    assert.ok((await likePost(store, club, "a", g, true, at(62))).ok);
    // Nobody looked until epoch 0 had closed: its points can't move, so they count in epoch 1.
    const holdings: Holdings = async (_t, ws) => ws.map((w) => ({ [wallet(3)]: 4n })[w.toLowerCase()] ?? 0n);
    const deps: RewardsDeps = {
      now: () => GENESIS + WEEK + 60,
      clubs: [club],
      events: async () => [],
      holdings,
      chainId: 10143,
      contract: getAddress(wallet(0xee)),
      genesis: GENESIS,
      length: WEEK,
    };
    // The challenge ended with epoch 0, but the close ran before anyone settled it.
    await closeEpoch(store, 0, deps);
    const view = (await listChallenges(store, club, {}, { ...at(WEEK + 100) }))[0]!;
    assert.equal(view.settled!.epoch, 1);
    assert.equal((await readAwards(store, token, 0))["g"], undefined);
    assert.equal((await readAwards(store, token, 1))["g"]!.points, 10);
  });
});

describe("an entry earns through its challenge (ADR 0048)", () => {
  /** h: a Holder (1 NFT) whose X posts name the collection, so they count as X shares; a: a Holder (2 NFTs) who likes. */
  async function holders() {
    const store = await world();
    const w = wallet(7);
    await store.set(profileKey(w), { provider: "twitter", handle: "h7", userId: "h", updatedAt: 1 });
    await store.setMembers(userWalletsKey("h"), [w]);
    assert.ok((await joinClub(store, club, "h", [w], { holdings: async () => [1n] })).ok);
    return store;
  }
  const xPost = (store: Store, userId: string, s: number) => post(store, userId, s, "own", `gm ${NFT} ${s}`);
  const holdings: Holdings = async (_t, ws) => ws.map((w) => ({ [wallet(7)]: 1n, [wallet(4)]: 2n })[w.toLowerCase()] ?? 0n);
  const deps = (s: number): RewardsDeps => ({
    now: () => GENESIS + s,
    clubs: [club],
    // Momentum's events: the X shares and the Holders' Board posts.
    events: async () => [...xShareEvents(await readXShares(store_!, token)), ...(await momentumPostEvents(store_!, token))],
    holdings,
    chainId: 10143,
    contract: getAddress(wallet(0xee)),
    genesis: GENESIS,
    length: WEEK,
  });
  let store_: Store | undefined;
  const rowOf = async (s: number, w: string) => (await computeStandings(store_!, club, deps(s)))!.rows.find((r) => r.wallet === w);

  it("keeps the post in Momentum, but gives its author no active day, X share or backing; the liker still engages", async () => {
    const store = (store_ = await holders());
    const id = await start(store);
    const entry = await xPost(store, "h", 60);
    assert.ok((await getPost(store, token, entry))!.x!.counted, "an X share when posted");
    assert.ok((await enterChallenge(store, club, "h", id, entry, at(61))).ok);
    assert.ok((await likePost(store, club, "a", entry, true, at(62))).ok);

    assert.equal((await getPost(store, token, entry))!.entry, id);
    // Momentum still has the post and its X share.
    assert.ok((await momentumPostEvents(store, token)).some((e) => e.deal === entry));
    assert.deepEqual(
      xShareEvents(await readXShares(store, token)).map((e) => e.entry),
      [true],
    );

    const h = (await rowOf(100, wallet(7)))!;
    assert.deepEqual([h.days, h.xShares, h.xPoints, h.backedPoints], [0, 0, 0, 0]);
    const a = (await rowOf(100, wallet(4)))!;
    assert.ok((a.engagedPoints ?? 0) > 0, "liking an entry is still engaging");
    assert.equal(a.days, 1, "and makes the liker's day active");
  });

  it("frees the day's X-share slot, so the member's next X post still counts", async () => {
    const store = (store_ = await holders());
    const id = await start(store);
    const entry = await xPost(store, "h", 60);
    assert.ok((await enterChallenge(store, club, "h", id, entry, at(61))).ok);
    const next = await xPost(store, "h", 120);
    assert.ok((await getPost(store, token, next))!.x!.counted, "not refused by the daily limit");
    const h = (await rowOf(200, wallet(7)))!;
    assert.deepEqual([h.days, h.xShares], [1, 1]);
  });

  it("stays covered after a withdrawal, and earns again when the challenge is cancelled", async () => {
    const store = (store_ = await holders());
    const id = await start(store);
    const entry = await xPost(store, "h", 60);
    assert.ok((await enterChallenge(store, club, "h", id, entry, at(61))).ok);
    assert.ok((await likePost(store, club, "a", entry, true, at(62))).ok);
    assert.ok((await withdrawEntry(store, club, "h", id, at(63))).ok);
    assert.equal((await getPost(store, token, entry))!.entry, id, "taking it back doesn't let it earn the backing it collected");
    assert.equal((await rowOf(100, wallet(7)))!.backedPoints, 0);

    assert.ok((await cancelChallenge(store, club, actor("own", 1), id, at(110))).ok);
    assert.equal((await getPost(store, token, entry))!.entry, undefined);
    const h = (await rowOf(200, wallet(7)))!;
    assert.deepEqual([h.days, h.xShares], [1, 1]);
    assert.ok((h.backedPoints ?? 0) > 0);
  });

  it("refuses a post from an epoch already frozen: it has earned there", async () => {
    const store = (store_ = await holders());
    const id = await start(store, { epochs: 2 });
    const old = await xPost(store, "h", 60);
    await closeEpoch(store, 0, deps(WEEK + 60));
    assert.deepEqual(await enterChallenge(store, club, "h", id, old, at(WEEK + 100)), { ok: false, reason: "bad_post" });
    assert.ok((await enterChallenge(store, club, "h", id, await xPost(store, "h", WEEK + 120), at(WEEK + 121))).ok);
  });
});

describe("a challenge the Owner judges", () => {
  async function played() {
    const store = await world();
    const id = await start(store, { judging: "owner", prizes: [8, 3] });
    const g = await post(store, "g", 60);
    const a = await post(store, "a", 61);
    for (const [u, p] of [
      ["g", g],
      ["a", a],
    ] as const)
      assert.ok((await enterChallenge(store, club, u, id, p, at(63))).ok);
    return { store, id, g, a };
  }

  it("waits for the Owner's pick after the end, and only the Owner picks", async () => {
    const { store, id, g, a } = await played();
    assert.deepEqual(await pickWinners(store, club, actor("own", 1), id, [a], at(100)), { ok: false, reason: "not_judging" }, "before the end");
    // Likes aren't locked: the Owner may weigh them or not.
    assert.ok((await likePost(store, club, "x", g, true, at(END + 1))).ok);
    assert.equal((await listChallenges(store, club, {}, at(END + 1)))[0]!.phase, "judging");
    assert.deepEqual(await pickWinners(store, club, actor("mod", 2), id, [a], at(END + 2)), { ok: false, reason: "forbidden" });
    assert.deepEqual(await pickWinners(store, club, actor("a", 4), id, [a], at(END + 2)), { ok: false, reason: "forbidden" });
    const noOne = await pickWinners(store, club, actor("own", 1), id, ["nope"], at(END + 2));
    assert.equal(noOne.ok || noOne.reason, "invalid");
    const tooMany = await pickWinners(store, club, actor("own", 1), id, [a, g, a], at(END + 2));
    assert.equal(tooMany.ok || tooMany.reason, "invalid");
    const picked = await pickWinners(store, club, actor("own", 1), id, [a, g], at(END + 3));
    assert.ok(picked.ok);
    assert.deepEqual(picked.ok && picked.winners.map((w) => [w.wallet, w.points]), [
      [wallet(4), 8],
      [wallet(3), 3],
    ]);
    assert.deepEqual(await pickWinners(store, club, actor("own", 1), id, [a], at(END + 4)), { ok: false, reason: "not_judging" }, "settled");
    assert.deepEqual(
      Object.values(await readAwards(store, token, 1))
        .map((x) => [x.userId, x.points])
        .sort(),
      [
        ["a", 8],
        ["g", 3],
      ],
      "an Owner's pick counts in the epoch it's made in",
    );
    const log = await readLog(store, token);
    assert.equal(log.find((l) => l.action === "settle_challenge")!.actor, wallet(1), "the Owner's pick is logged under them");
  });

  it("expires with no winners if the Owner doesn't pick in time", async () => {
    const { store, id } = await played();
    assert.equal(await settleDue(store, club, at(END + 13 * DAY)), 0);
    assert.equal(await settleDue(store, club, at(END + CHALLENGE_RULES.pickWindowMs / 1000 + 1)), 1);
    const done = (await listChallenges(store, club, {}, at(END + 15 * DAY))).find((c) => c.id === id)!;
    assert.deepEqual([done.phase, done.settled!.expired, done.settled!.winners], ["settled", true, []]);
    assert.deepEqual(await pickWinners(store, club, actor("own", 1), id, [], at(END + 16 * DAY)), { ok: false, reason: "not_judging" });
  });
});

describe("challenges in the system messages (the Board and the timeline)", () => {
  it("tells when one starts and who won, not a cancelled one", async () => {
    const store = await world();
    const id = await start(store, { title: "Best meme" });
    const gone = await start(store, { title: "Called off" });
    assert.ok((await cancelChallenge(store, club, actor("own", 1), gone, at(20))).ok);
    const g = await post(store, "g", 60);
    assert.ok((await enterChallenge(store, club, "g", id, g, at(61))).ok);
    assert.ok((await likePost(store, club, "a", g, true, at(62))).ok);
    const sys = (s: number) => listSystem(store, [club], { now: () => GENESIS + s, settlements: async () => [] });

    const early = (await sys(100)).events.filter((e) => e.kind === "challenge" || e.kind === "winner");
    assert.deepEqual(
      early.map((e) => [e.id, e.kind, e.wallets, e.title]),
      [[`challenge:${id}`, "challenge", [wallet(1)], "Best meme"]],
    );

    await listChallenges(store, club, {}, at(END + 500));
    const late = (await sys(END + 600)).events.filter((e) => e.kind === "winner");
    assert.deepEqual(
      late.map((e) => [e.id, e.wallets, e.title, e.at]),
      [[`challenge-won:${id}`, [wallet(3)], "Best meme", GENESIS + END]],
      "told at its end",
    );
  });
});

describe("challenges pinned on the timeline", () => {
  it("are the running ones, each with its Club, until they are settled", async () => {
    const store = await world();
    const later = await start(store, { title: "Two weeks", epochs: 2 });
    const soon = await start(store, { title: "This week" });
    const gone = await start(store, { title: "Called off" });
    assert.ok((await cancelChallenge(store, club, actor("own", 1), gone, at(20))).ok);
    const owner = await start(store, { title: "Owner picks", judging: "owner" }, 30);
    const g = await post(store, "g", 60);
    assert.ok((await enterChallenge(store, club, "g", soon, g, at(61))).ok);
    assert.ok((await likePost(store, club, "a", g, true, at(62))).ok);

    const open = await liveChallenges(store, [club], { userId: "g" }, at(100));
    assert.ok(open.every((p) => p.club === token));
    // Soonest end first: the two ending with this epoch, then the one that runs on.
    assert.deepEqual(
      open
        .map((p) => p.challenge.id)
        .slice(0, 2)
        .sort(),
      [soon, owner].sort(),
    );
    assert.equal(open[2]!.challenge.id, later);
    assert.equal(open.find((p) => p.challenge.id === soon)!.challenge.mine, g);

    // Past the end, the likes-judged one is settled and drops off; the Owner's waits on their pick.
    const after = await liveChallenges(store, [club], {}, at(END + 5));
    assert.deepEqual(
      after.map((p) => [p.challenge.id, p.challenge.phase]),
      [
        [later, "open"],
        [owner, "judging"],
      ],
    );
    assert.equal((await getChallenge(store, club, soon, {}, at(END + 6)))!.phase, "settled");
  });
});

describe("one challenge's details", () => {
  it("has the brief and the entries members posted, and nothing for an unknown id", async () => {
    const store = await world();
    const id = await start(store);
    const g = await post(store, "g", 60);
    assert.ok((await enterChallenge(store, club, "g", id, g, at(61))).ok);
    assert.ok((await likePost(store, club, "a", g, true, at(62))).ok);
    const view = (await getChallenge(store, club, id, { userId: "g" }, at(100)))!;
    assert.deepEqual([view.title, view.brief, view.entryCount, view.mine], ["Best Chog meme", "Post your funniest Chog.", 1, g]);
    assert.deepEqual(
      view.entries.map((e) => [e.post, e.wallet, e.likes, e.mine, e.text]),
      [[g, wallet(3), 1, true, "gm g 60"]],
    );
    assert.equal((await getChallenge(store, club, id, { userId: "a" }, at(100)))!.entries[0]!.liked, true);
    assert.equal((await getChallenge(store, club, id, { userId: "x" }, at(100)))!.entries[0]!.liked, false);
    assert.equal(await getChallenge(store, club, "not-an-id", {}, at(100)), null);
    assert.equal(await getChallenge(store, club, "00000000-0000-0000-0000-000000000000", {}, at(100)), null);
    // Asking after it ended settles it.
    assert.equal((await getChallenge(store, club, id, {}, at(END + 1)))!.phase, "settled");
  });
});

describe("the challenge routes", () => {
  it("start with the Owner and take entries and picks from members", async () => {
    const store = await world();
    let who = "own";
    const gate = async (): Promise<UserGate> => ({ store, user: { id: who, linked_accounts: [] } }) as unknown as UserGate;
    const deps = { ...at(START), gate };
    const list = challengesHandlers(reg, deps);
    const one = challengeHandlers(reg, deps);
    const ctx = { params: Promise.resolve({ token: NFT }) };
    const req = (method: string, body?: unknown) =>
      new Request("http://x/api", { method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { "x-forwarded-for": "203.0.113.9" } });

    who = "a";
    assert.equal((await list.POST(req("POST", input()), ctx)).status, 403);
    who = "own";
    assert.equal((await list.POST(req("POST", input({ prizes: [] })), ctx)).status, 400);
    const created = await list.POST(req("POST", input()), ctx);
    assert.equal(created.status, 201);
    const { id } = (await created.json()) as { id: string };

    const mine = await post(store, "g", 60);
    const itemCtx = { params: Promise.resolve({ token: NFT, id }) };
    who = "g";
    const late = challengeHandlers(reg, { ...deps, now: () => (GENESIS + 100) * 1000 });
    assert.equal((await late.POST(req("POST", { action: "enter", post: mine }), itemCtx)).status, 200);
    assert.equal((await late.POST(req("POST", { action: "dance" }), itemCtx)).status, 400);
    assert.equal((await late.POST(req("POST", { action: "cancel" }), itemCtx)).status, 403);
    assert.equal((await one.POST(req("POST", { action: "pick", posts: [mine] }), itemCtx)).status, 403);

    // The read route takes its store from the environment, as the other public reads do: the list itself is checked here.
    assert.deepEqual(
      (await listChallenges(store, club, {}, at(200))).map((c) => [c.id, c.entryCount]),
      [[id, 1]],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// More ways to pick winners (ADR 0049)

/** Two more members with the Holder badge: h1 (wallet 7) and h2 (wallet 8). */
async function withHolders(store: Store) {
  for (const [u, n] of [
    ["h1", 7],
    ["h2", 8],
  ] as const) {
    const w = wallet(n);
    await store.set(profileKey(w), { provider: "twitter", handle: `h${n}`, userId: u, updatedAt: 1 });
    await store.setMembers(userWalletsKey(u), [w]);
    assert.ok((await joinClub(store, club, u, [w], { holdings: async () => [1n] })).ok);
  }
  return store;
}

/** A chain to draw from: the newest block, and the hashes of the blocks that are final. */
function fakeChain(head = 5_000n) {
  const hashes = new Map<bigint, Hex>();
  const state = { head, down: false, reads: 0 };
  const blocks: BlockReader = {
    async latest() {
      state.reads++;
      if (state.down) throw new Error("rpc down");
      return state.head;
    },
    async hashOf(n) {
      state.reads++;
      if (state.down) throw new Error("rpc down");
      return hashes.get(n) ?? null;
    },
  };
  return { blocks, hashes, state };
}
const hashOf = (label: string) => keccak256(stringToHex(label));

const flatInput = (judging: string, over: Record<string, unknown> = {}) => ({
  title: "Flat",
  brief: "Do the thing.",
  judging,
  winners: 2,
  prize: 3,
  epochs: 1,
  ...over,
});
async function startFlat(store: Store, judging: string, over: Record<string, unknown> = {}) {
  const r = await createChallenge(store, club, actor("own", 1), flatInput(judging, over), at(START));
  assert.ok(r.ok, JSON.stringify(r));
  return r.id;
}

/** Entries from g (60 s), a (61 s), x (62 s) and mod (63 s) in challenge `id`, in that order. */
async function enterAll(store: Store, id: string) {
  const posts: Record<string, string> = {};
  for (const [u, s] of [
    ["g", 60],
    ["a", 61],
    ["x", 62],
    ["mod", 63],
  ] as const) {
    posts[u] = await post(store, u, s);
    assert.ok((await enterChallenge(store, club, u, id, posts[u], at(s + 1))).ok, u);
  }
  return posts as { g: string; a: string; x: string; mod: string };
}

describe("checking the new ways to pick winners", () => {
  it("takes a flat prize for raffle, first in and everyone, within the protocol's bounds", () => {
    for (const judging of ["raffle", "first", "everyone"]) {
      const r = checkChallenge(flatInput(judging));
      assert.ok(r.ok, judging);
      assert.deepEqual(r.ok && [r.challenge.prizes, r.challenge.winners, r.challenge.prize], [[3, 3], 2, 3], "kept as one prize per winner");
    }
    assert.equal((checkChallenge(flatInput("everyone")) as { challenge: { minLikes?: number } }).challenge.minLikes, 0, "any entry by default");
    assert.ok(checkChallenge(flatInput("raffle", { prize: 0 })).ok, "a trophy only");
    assert.ok(checkChallenge(flatInput("raffle", { winners: CHALLENGE_RULES.maxWinners, prize: CHALLENGE_RULES.maxFlatPoints })).ok);
    assert.ok(checkChallenge(flatInput("everyone", { minLikes: CHALLENGE_RULES.maxMinLikes })).ok);
    assert.ok(checkChallenge(input({ judging: "holders" })).ok, "a Holder vote pays places");
    const bad = (over: Record<string, unknown>) => assert.equal(checkChallenge(over).ok, false, JSON.stringify(over));
    bad(flatInput("raffle", { winners: 0 }));
    bad(flatInput("raffle", { winners: CHALLENGE_RULES.maxWinners + 1 }));
    bad(flatInput("first", { prize: CHALLENGE_RULES.maxFlatPoints + 1 }));
    bad(flatInput("first", { prize: -1 }));
    bad(flatInput("first", { prize: 1.5 }));
    bad(flatInput("first", { prize: undefined }));
    bad(flatInput("everyone", { minLikes: CHALLENGE_RULES.maxMinLikes + 1 }));
    bad(flatInput("raffle", { minLikes: 2 }));
    bad(flatInput("raffle", { prizes: [3] }));
    bad(input({ judging: "holders", winners: 2 }));
    bad(input({ judging: "owner", prize: 2 }));
    bad(flatInput("raffle", { winners: Number.NaN }));
    // Flat points stay below a ranked place's, and the per-epoch cap is the protocol's.
    assert.ok(CHALLENGE_RULES.maxFlatPoints < CHALLENGE_RULES.maxPoints);
    assert.equal(CHALLENGE_CAP_PER_EPOCH, 20);
  });

  it("locks likes only where they decide", () => {
    assert.deepEqual(
      (["likes", "holders", "owner", "raffle", "first"] as const).map((judging) => likesDecide({ judging })),
      [true, true, false, false, false],
    );
    assert.equal(likesDecide({ judging: "everyone", minLikes: 0 }), false);
    assert.equal(likesDecide({ judging: "everyone", minLikes: 2 }), true);
  });
});

describe("the pure picks", () => {
  const c = (post: string, userId: string, at: number, likes: number) => ({ post, userId, wallet: `w${userId}`, at, likes });

  it("takes the earliest entries, with enough likes, a member once", () => {
    const cands = [c("p3", "u3", 30, 0), c("p1", "u1", 10, 2), c("p2", "u2", 20, 1), c("p4", "u1", 5, 0)];
    assert.deepEqual(
      winnersByTime(cands, 2, 4).map((w) => [w.post, w.place, w.points]),
      [
        ["p4", 1, 4],
        ["p2", 2, 4],
      ],
      "u1's later entry doesn't win twice",
    );
    assert.deepEqual(
      winnersByTime(cands, 5, 4, 1).map((w) => w.post),
      ["p1", "p2"],
    );
    assert.deepEqual(winnersByTime(cands, 5, 0, 3), []);
  });

  it("draws the same order from the same seed, and anyone can redo it", () => {
    const seed = drawSeed(hashOf("block"), "00000000-0000-0000-0000-000000000001");
    assert.equal(seed, keccak256(concat([hashOf("block"), stringToHex("00000000-0000-0000-0000-000000000001")])));
    const posts = Array.from({ length: 12 }, (_, i) => `post-${String(i).padStart(2, "0")}`);
    const order = drawOrder(seed, posts);
    assert.deepEqual([...order].sort(), [...posts].sort(), "a permutation");
    assert.deepEqual(drawOrder(seed, [...posts].reverse()), order, "the order the pool comes in doesn't matter");
    assert.notDeepEqual(drawOrder(drawSeed(hashOf("other"), "00000000-0000-0000-0000-000000000001"), posts), order, "another block, another order");
    const cands = posts.map((p, i) => c(p, `u${i}`, i, 0));
    assert.deepEqual(
      drawWinners(seed, cands, 3).map((x) => x.post),
      order.slice(0, 3),
    );
    // One that dropped out is skipped, not redrawn: the next in the same order moves up.
    const without = cands.filter((x) => x.post !== order[1]);
    assert.deepEqual(
      drawWinners(seed, without, 3, posts).map((x) => x.post),
      [order[0], order[2], order[3]],
    );
  });
});

describe("a Holder vote", () => {
  it("counts only likes from Holders, and locks them at the end", async () => {
    const store = await withHolders(await world());
    const id = await start(store, { judging: "holders", prizes: [10, 5] });
    const g = await post(store, "g", 60);
    const a = await post(store, "a", 61);
    for (const [u, p] of [
      ["g", g],
      ["a", a],
    ] as const)
      assert.ok((await enterChallenge(store, club, u, id, p, at(62))).ok);
    // g: two likes, neither from a Holder; a: one, from a Holder.
    for (const [who, p] of [
      ["x", g],
      ["mod", g],
      ["h1", a],
    ] as const)
      assert.ok((await likePost(store, club, who, p, true, at(70))).ok);
    const open = (await getChallenge(store, club, id, {}, at(100)))!;
    assert.deepEqual(
      open.entries.map((e) => [e.post, e.likes, e.votes]),
      [
        [a, 1, 1],
        [g, 2, 0],
      ],
      "ranked by the Holders' likes",
    );
    assert.deepEqual(await likePost(store, club, "h2", g, true, at(END)), { ok: false, reason: "voting_closed" });
    const done = (await getChallenge(store, club, id, {}, at(END + 1)))!;
    assert.deepEqual(
      done.settled!.winners.map((w) => [w.post, w.place, w.points, w.likes]),
      [[a, 1, 10, 1]],
      "g had no Holder's like",
    );
  });
});

describe("a raffle", () => {
  it("commits a future block after the end, then draws with its hash, verifiably", async () => {
    const store = await world();
    const chain = fakeChain();
    const id = await startFlat(store, "raffle", { winners: 2, prize: 3, title: "Raffle" });
    const posts = await enterAll(store, id);
    // Likes don't decide a raffle: nothing locks.
    assert.equal(await votingClosed(store, token, posts.g, (GENESIS + END + 1) * 1000), false);
    assert.equal(chain.state.reads, 0);

    // The first read after the end commits a block that doesn't exist yet.
    const drawing = (await getChallenge(store, club, id, {}, { ...at(END + 1), blocks: chain.blocks }))!;
    assert.deepEqual([drawing.phase, drawing.drawBlock, drawing.settled], ["closing", 5_000 + CHALLENGE_RULES.drawMargin, undefined]);
    const stored = (await store.get<StoredChallenge>(challengeKey(token, id)))!;
    assert.deepEqual(stored.drawPool, Object.values(posts).sort());
    // Once committed, the Owner can't call it off to choose the result.
    assert.deepEqual(await cancelChallenge(store, club, actor("own", 1), id, at(END + 2)), { ok: false, reason: "drawing" });
    // A newer head doesn't move the committed block.
    chain.state.head = 9_000n;
    assert.equal(await settleDue(store, club, { ...at(END + 3), blocks: chain.blocks }), 0, "the block isn't final yet");
    assert.equal((await store.get<StoredChallenge>(challengeKey(token, id)))!.drawBlock, 5_010);

    const hash = hashOf("block 5010");
    chain.hashes.set(5_010n, hash);
    assert.equal(await settleDue(store, club, { ...at(END + 4), blocks: chain.blocks }), 1);
    const done = (await getChallenge(store, club, id, {}, at(END + 5)))!;
    const draw = done.settled!.draw!;
    assert.deepEqual([draw.block, draw.hash, draw.seed], [5_010, hash, drawSeed(hash, id)]);
    // Anyone can redo it from what is published.
    const expected = drawOrder(draw.seed as Hex, draw.pool).slice(0, 2);
    assert.deepEqual(
      done.settled!.winners.map((w) => [w.post, w.place, w.points]),
      [
        [expected[0], 1, 3],
        [expected[1], 2, 3],
      ],
    );
    assert.equal(done.settled!.epoch, 0, "in the epoch it ended in");
    const awards = await readAwards(store, token, 0);
    assert.deepEqual(
      Object.values(awards).map((x) => x.points),
      [3, 3],
    );
    assert.equal(await settleDue(store, club, { ...at(END + 6), blocks: chain.blocks }), 0, "drawn once");
  });

  it("skips an entry that dropped out after the commit, rather than redrawing", async () => {
    const store = await world();
    const chain = fakeChain();
    const id = await startFlat(store, "raffle", { winners: 2, prize: 3 });
    await enterAll(store, id);
    await settleDue(store, club, { ...at(END + 1), blocks: chain.blocks });
    const hash = hashOf("skip");
    chain.hashes.set(5_010n, hash);
    const pool = (await store.get<StoredChallenge>(challengeKey(token, id)))!.drawPool!;
    const order = drawOrder(drawSeed(hash, id), pool);
    // The Owner sees who the block would pick and hides them: the next in line wins, nobody is redrawn.
    assert.ok((await hidePost(store, club, actor("own", 1), order[0]!, true, at(END + 2))).ok);
    await settleDue(store, club, { ...at(END + 3), blocks: chain.blocks });
    const done = (await getChallenge(store, club, id, {}, at(END + 4)))!;
    assert.deepEqual(
      done.settled!.winners.map((w) => w.post),
      [order[1], order[2]],
    );
    assert.deepEqual(done.settled!.draw!.pool, pool, "the pool published is the one committed");
  });

  it("waits out a chain that can't be read, and settles an empty one without it", async () => {
    const store = await world();
    const chain = fakeChain();
    chain.state.down = true;
    const id = await startFlat(store, "raffle");
    await enterAll(store, id);
    assert.equal(await settleDue(store, club, { ...at(END + 1), blocks: chain.blocks }), 0);
    assert.equal((await store.get<StoredChallenge>(challengeKey(token, id)))!.drawBlock, undefined, "nothing committed");
    chain.state.down = false;
    await settleDue(store, club, { ...at(END + 2), blocks: chain.blocks });
    assert.equal((await store.get<StoredChallenge>(challengeKey(token, id)))!.drawBlock, 5_010);

    const empty = await createChallenge(store, club, actor("own", 1), flatInput("raffle", { title: "Empty" }), at(WEEK + 10));
    assert.ok(empty.ok);
    chain.state.down = true;
    const reads = chain.state.reads;
    assert.equal(await settleDue(store, club, { ...at(2 * WEEK + 1), blocks: chain.blocks }), 1, "no entries: settled with nobody, no block needed");
    assert.equal(chain.state.reads, reads + 1, "only the first raffle's pending read");
    assert.deepEqual((await getChallenge(store, club, empty.id, {}, at(2 * WEEK + 2)))!.settled!.winners, []);
  });
});

describe("first in", () => {
  it("pays the first entries posted, and moves the next one up when one drops out", async () => {
    const store = await world();
    const id = await startFlat(store, "first", { winners: 2, prize: 4 });
    const posts = await enterAll(store, id);
    const open = (await getChallenge(store, club, id, {}, at(100)))!;
    assert.deepEqual(
      open.entries.map((e) => e.post),
      [posts.g, posts.a, posts.x, posts.mod],
      "in the order posted",
    );
    assert.deepEqual([open.winners, open.prize], [2, 4]);
    // Likes don't decide: they aren't locked at the end.
    assert.ok((await likePost(store, club, "a", posts.g, true, at(END))).ok);
    // g's entry is hidden before the end: a and x are the first two left.
    assert.ok((await hidePost(store, club, actor("own", 1), posts.g, true, at(200))).ok);
    const done = (await getChallenge(store, club, id, {}, at(END + 1)))!;
    assert.deepEqual(
      done.settled!.winners.map((w) => [w.post, w.place, w.points]),
      [
        [posts.a, 1, 4],
        [posts.x, 2, 4],
      ],
    );
  });
});

describe("everyone who completes", () => {
  it("pays every entry with enough likes, earliest first up to the cap, and locks the likes", async () => {
    const store = await world();
    const id = await startFlat(store, "everyone", { winners: 2, prize: 5, minLikes: 1 });
    const posts = await enterAll(store, id);
    for (const [who, p] of [
      ["a", posts.g],
      ["g", posts.x],
      ["g", posts.mod],
    ] as const)
      assert.ok((await likePost(store, club, who, p, true, at(100))).ok);
    assert.deepEqual(await likePost(store, club, "x", posts.a, true, at(END)), { ok: false, reason: "voting_closed" });
    const done = (await getChallenge(store, club, id, {}, at(END + 1)))!;
    assert.deepEqual(
      done.settled!.winners.map((w) => [w.post, w.place, w.points]),
      [
        [posts.g, 1, 5],
        [posts.x, 2, 5],
      ],
      "a had no like; mod is past the cap",
    );
    assert.equal(done.minLikes, 1);
  });

  it("with no likes asked, takes any entry and locks nothing", async () => {
    const store = await world();
    const id = await startFlat(store, "everyone", { winners: 10, prize: 2 });
    const posts = await enterAll(store, id);
    assert.equal(await votingClosed(store, token, posts.g, (GENESIS + END) * 1000), false);
    const done = (await getChallenge(store, club, id, {}, at(END + 1)))!;
    assert.deepEqual(
      done.settled!.winners.map((w) => w.place),
      [1, 2, 3, 4],
    );
  });

  it("names the winners of a trophy-only prize, but adds nothing to the epoch", async () => {
    const store = await world();
    const id = await startFlat(store, "everyone", { winners: 3, prize: 0 });
    await enterAll(store, id);
    const done = (await getChallenge(store, club, id, {}, at(END + 1)))!;
    assert.equal(done.settled!.winners.length, 3);
    assert.equal(done.settled!.epoch, undefined);
    assert.deepEqual(await readAwards(store, token, 0), {});
  });

  it("puts flat points into the epoch's ledger, numbered in order", async () => {
    const store = await world();
    const id = await startFlat(store, "everyone", { winners: 3, prize: 5 });
    await enterAll(store, id);
    assert.equal(await settleDue(store, club, at(WEEK + 1)), 1);
    const holdings: Holdings = async (_t, ws) => ws.map((w) => ({ [wallet(3)]: 4n, [wallet(4)]: 2n })[w.toLowerCase()] ?? 0n);
    const deps: RewardsDeps = {
      now: () => GENESIS + WEEK + 60,
      clubs: [club],
      events: async () => [],
      holdings,
      chainId: 10143,
      contract: getAddress(wallet(0xee)),
      genesis: GENESIS,
      length: WEEK,
    };
    await closeEpoch(store, 0, deps);
    await buildEpoch(store, 0, deps);
    const ledger = (await store.get<Record<string, PublishedLedger>>(pointsKey(0)))![token]!;
    assert.equal(ledger.rows.find((r) => r.wallet === wallet(3))!.challengePoints, 5);
    assert.deepEqual(
      ledger.challenges!.wins.map((w) => [w.wallet, w.place, w.points]),
      [
        [wallet(3), 1, 5],
        [wallet(4), 2, 5],
        [wallet(5), 3, 5],
      ],
    );
  });
});

describe("challenges kept before ADR 0049", () => {
  it("still read and settle as they did", async () => {
    const store = await world();
    // As kept before: no holdersOnly, no winners, prize or draw.
    const old = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Old one",
      brief: "From before.",
      judging: "likes",
      prizes: [7],
      startsAt: (GENESIS + START) * 1000,
      endsAt: (GENESIS + END) * 1000,
      by: wallet(1),
      state: "live",
    };
    await store.set(challengeKey(token, old.id), old);
    await store.rank(challengesKey(token), [{ member: old.id, score: old.startsAt }], CHALLENGE_RULES.kept);
    const g = await post(store, "g", 60);
    await store.addMember(entriesKey(token, old.id), `${g}|g`);
    await store.set(entryOfKey(token, g), old.id);
    assert.ok((await likePost(store, club, "a", g, true, at(70))).ok);
    const view = (await getChallenge(store, club, old.id, {}, at(100)))!;
    assert.deepEqual([view.judging, view.prizes, view.holdersOnly, view.winners, view.prize], ["likes", [7], false, undefined, undefined]);
    assert.deepEqual(await likePost(store, club, "x", g, true, at(END)), { ok: false, reason: "voting_closed" });
    const done = (await getChallenge(store, club, old.id, {}, at(END + 1)))!;
    assert.deepEqual(
      done.settled!.winners.map((w) => [w.post, w.points]),
      [[g, 7]],
    );
    assert.equal(done.settled!.draw, undefined);
  });
});

describe("the challenge routes, for the new ways", () => {
  it("start a raffle, and refuse a mixed-up prize", async () => {
    const store = await world();
    const gate = async (): Promise<UserGate> => ({ store, user: { id: "own", linked_accounts: [] } }) as unknown as UserGate;
    const list = challengesHandlers(reg, { ...at(START), gate });
    const ctx = { params: Promise.resolve({ token: NFT }) };
    const req = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.9" } });
    assert.equal((await list.POST(req(flatInput("raffle", { winners: 5, prize: 2 })), ctx)).status, 201);
    const mixed = await list.POST(req(flatInput("raffle", { prizes: [3] })), ctx);
    assert.equal(mixed.status, 400);
    const log = await readLog(store, token);
    assert.match(log.find((l) => l.action === "create_challenge")!.detail ?? "", /5 × 2 points · judged by raffle/);
  });
});
