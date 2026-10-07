import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { CHALLENGE_CAP_PER_EPOCH, CHALLENGE_RULES, checkChallenge, phaseOf, prizeText, winnersByLikes, winnersByPick } from "../lib/challenges";
import type { ActivityEvent } from "../lib/clubs";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { banUser, createPost, deletePost, hidePost, likePost, type Deps } from "../lib/server/board";
import { challengesHandlers, challengeHandlers } from "../lib/server/boardRoutes";
import { cancelChallenge, createChallenge, enterChallenge, getChallenge, listChallenges, pickWinners, settleDue, withdrawEntry } from "../lib/server/challenges";
import { readAwards } from "../lib/server/challengeState";
import { readLog, saveRoles } from "../lib/server/clubState";
import type { UserGate } from "../lib/server/gate";
import { getMember, joinClub, type Holdings } from "../lib/server/members";
import { buildEpoch, closeEpoch, pointsKey, type PublishedLedger, type RewardsDeps } from "../lib/server/rewards";
import { listSystem } from "../lib/server/system";
import { setRewardBan } from "../lib/server/rewardSettings";
import { computeStandings } from "../lib/server/standings";
import { memoryStore, type Store } from "../lib/server/store";
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
async function post(store: Store, userId: string, s: number, x: "own" | "none" | "theirs" | number = "own") {
  await store.del(`declub:rl:club-post-cd:${token}:${userId}`, `declub:rl:club-post-hr:${token}:${userId}`);
  const id = String(tweetId++);
  tweets.set(id, { id, author: x === "theirs" ? "someone" : userId, text: `my entry ${s}`, postedAt: (GENESIS + (typeof x === "number" ? x : s)) * 1000 });
  const link = x === "none" ? {} : { link: `https://x.com/${userId}/status/${id}` };
  const r = await createPost(store, club, userId, { kind: "note", text: `gm ${userId} ${s}`, ...link }, at(s));
  assert.ok(r.ok);
  return r.post.id;
}
/** An Owner (1), a Moderator (2), Holders g (4 NFTs) and a (2), and x, a member with no NFT. */
async function world() {
  const store = memoryStore();
  for (const [u, n] of [["own", 1], ["mod", 2], ["g", 3], ["a", 4], ["x", 5]] as const) await member(store, u, n);
  await saveRoles(store, token, { owner: "own", moderators: ["mod"] });
  return store;
}
const input = (over: Record<string, unknown> = {}) => ({ title: "Best Chog meme", brief: "Post your funniest Chog.", judging: "likes", prizes: [10, 5], epochs: 1, ...over });
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
    bad({ prizes: [0] });
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
    assert.deepEqual(winners.map((w) => [w.post, w.place, w.points]), [["p4", 1, 10], ["p2", 2, 5]], "p3 has no likes, and u1 wins once");
    assert.deepEqual(winnersByLikes([c("p1", "u1", 1, 1)], [10, 5]).map((w) => w.place), [1], "fewer entries than places");
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
    for (const who of [actor("mod", 2), actor("a", 4)]) assert.deepEqual(await createChallenge(store, club, who, input(), at(START)), { ok: false, reason: "forbidden" });
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
    assert.deepEqual(view.entries.map((e) => e.post), [second], "a new entry replaces the old");
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
    assert.deepEqual(done.settled!.winners.map((w) => [w.wallet, w.points]), [[wallet(2), 10]]);
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
    for (const [u, p] of [["mod", m2], ["g", g2]] as const) assert.ok((await enterChallenge(store2, club, u, id2, p, at(63))).ok);
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
    for (const [u, p] of [["g", g], ["a", a], ["x", x]] as const) assert.ok((await enterChallenge(store, club, u, id, p, at(63))).ok, u);
    // g: 3 likes, a: 2, x: 0.
    for (const [who, p] of [["a", g], ["x", g], ["mod", g], ["g", a], ["x", a]] as const) assert.ok((await likePost(store, club, who, p, true, at(100))).ok);
    return { store, id, g, a, x };
  }

  it("pays the most liked, and locks the likes when it ends", async () => {
    const { store, id, g, a, x } = await played();
    const open = (await listChallenges(store, club, {}, at(200)))[0]!;
    assert.equal(open.phase, "open");
    assert.deepEqual(open.entries.map((e) => [e.post, e.likes]), [[g, 3], [a, 2], [x, 0]]);

    // Taking a like back is still fine while it runs.
    assert.ok((await likePost(store, club, "mod", g, false, at(300))).ok);
    assert.ok((await likePost(store, club, "mod", g, true, at(301))).ok);
    // From the end the tally is locked, either way.
    assert.deepEqual(await likePost(store, club, "mod", a, true, at(END)), { ok: false, reason: "voting_closed" });
    assert.deepEqual(await likePost(store, club, "a", g, false, at(END)), { ok: false, reason: "voting_closed" });

    const settled = (await listChallenges(store, club, {}, at(END + 5)))[0]!;
    assert.equal(settled.phase, "settled");
    assert.deepEqual(settled.settled!.winners.map((w) => [w.post, w.wallet, w.place, w.points]), [[g, wallet(3), 1, 10], [a, wallet(4), 2, 5]]);
    assert.equal(settled.settled!.epoch, 0);
    assert.deepEqual(settled.entries.map((e) => e.place), [1, 2, undefined]);
    assert.equal(await settleDue(store, club, at(END + 10)), 0, "settled once");
    const awards = await readAwards(store, token, 0);
    assert.deepEqual(Object.values(awards).map((x) => [x.userId, x.points]).sort(), [["a", 5], ["g", 10]]);
    assert.ok((await readLog(store, token)).some((l) => l.action === "settle_challenge" && l.target === id));
  });

  const rewardsDeps = (over: Partial<RewardsDeps> = {}): RewardsDeps => {
    const holdings: Holdings = async (_t, ws) => ws.map((w) => ({ [wallet(1)]: 1n, [wallet(3)]: 4n, [wallet(4)]: 2n })[w.toLowerCase()] ?? 0n);
    const swap: ActivityEvent = { id: "0x1:0", kind: "swapped", contract: "0xswap", deal: "1", block: 1, at: GENESIS + 100, parties: [wallet(8), wallet(9)], tokens: [token], fee: (4n * 10n ** 18n).toString() };
    return { now: () => GENESIS + WEEK + 60, clubs: [club], events: async () => [swap], holdings, chainId: 10143, contract: getAddress(wallet(0xee)), genesis: GENESIS, length: WEEK, ...over };
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
    assert.equal(settled.entries.some((e) => e.post === a), false);
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
    const ids = [await start(store, { prizes: [15], title: "One" }), await start(store, { prizes: [15], title: "Two" }), await start(store, { prizes: [15], title: "Three" })];
    for (const [i, id] of ids.entries()) {
      const p = await post(store, "g", 60 + i);
      assert.ok((await enterChallenge(store, club, "g", id, p, at(70))).ok);
      assert.ok((await likePost(store, club, "a", p, true, at(80))).ok);
    }
    await listChallenges(store, club, {}, at(END + 1));
    assert.equal((await readAwards(store, token, 0))["g"]!.points, 45, "the wins are all kept and published");
    const holdings: Holdings = async (_t, ws) => ws.map((w) => ({ [wallet(3)]: 4n, [wallet(4)]: 2n })[w.toLowerCase()] ?? 0n);
    const deps: RewardsDeps = { now: () => GENESIS + WEEK + 60, clubs: [club], events: async () => [], holdings, chainId: 10143, contract: getAddress(wallet(0xee)), genesis: GENESIS, length: WEEK };
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
    const deps: RewardsDeps = { now: () => GENESIS + WEEK + 60, clubs: [club], events: async () => [], holdings, chainId: 10143, contract: getAddress(wallet(0xee)), genesis: GENESIS, length: WEEK };
    // The challenge ended with epoch 0, but the close ran before anyone settled it.
    await closeEpoch(store, 0, deps);
    const view = (await listChallenges(store, club, {}, { ...at(WEEK + 100) }))[0]!;
    assert.equal(view.settled!.epoch, 1);
    assert.equal((await readAwards(store, token, 0))["g"], undefined);
    assert.equal((await readAwards(store, token, 1))["g"]!.points, 10);
  });
});

describe("a challenge the Owner judges", () => {
  async function played() {
    const store = await world();
    const id = await start(store, { judging: "owner", prizes: [8, 3] });
    const g = await post(store, "g", 60);
    const a = await post(store, "a", 61);
    for (const [u, p] of [["g", g], ["a", a]] as const) assert.ok((await enterChallenge(store, club, u, id, p, at(63))).ok);
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
    assert.deepEqual(picked.ok && picked.winners.map((w) => [w.wallet, w.points]), [[wallet(4), 8], [wallet(3), 3]]);
    assert.deepEqual(await pickWinners(store, club, actor("own", 1), id, [a], at(END + 4)), { ok: false, reason: "not_judging" }, "settled");
    assert.deepEqual(Object.values(await readAwards(store, token, 1)).map((x) => [x.userId, x.points]).sort(), [["a", 8], ["g", 3]], "an Owner's pick counts in the epoch it's made in");
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
    assert.deepEqual(early.map((e) => [e.id, e.kind, e.wallets, e.title]), [[`challenge:${id}`, "challenge", [wallet(1)], "Best meme"]]);

    await listChallenges(store, club, {}, at(END + 500));
    const late = (await sys(END + 600)).events.filter((e) => e.kind === "winner");
    assert.deepEqual(late.map((e) => [e.id, e.wallets, e.title, e.at]), [[`challenge-won:${id}`, [wallet(3)], "Best meme", GENESIS + END]], "told at its end");
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
    assert.deepEqual(view.entries.map((e) => [e.post, e.wallet, e.likes, e.mine, e.text]), [[g, wallet(3), 1, true, "gm g 60"]]);
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
    const req = (method: string, body?: unknown) => new Request("http://x/api", { method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { "x-forwarded-for": "203.0.113.9" } });

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
    assert.deepEqual((await listChallenges(store, club, {}, at(200))).map((c) => [c.id, c.entryCount]), [[id, 1]]);
  });
});
