import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PINNED, POSTS_PER_HOUR, POST_MAX, REPORTS_PER_DAY, REPORTS_TO_HIDE, type PostLink } from "../lib/clubPosts";
import { profileKey, userWalletsKey } from "../lib/profiles";
import {
  banUser, claimOwner, createPost, deletePost, hidePost, likePost, listBans, listPosts, ownershipCheck, pinPost, purgeClub,
  reportPost, roleIn, setRole, unbanUser, updateProfile, postsKey, postKey, type Actor, type Deps,
} from "../lib/server/board";
import { activityKey } from "../lib/server/activity";
import { activeKey } from "../lib/server/activeDays";
import { streaksKey } from "../lib/server/streaks";
import { REWARDS_GENESIS } from "../lib/config";
import { clubInbox, standingsNews } from "../lib/server/inbox";
import { createReply } from "../lib/server/board";
import type { ClubStandings, StandingRow } from "../lib/server/standings";
import { loadBans, loadProfile, loadRoles, readLog, saveRoles } from "../lib/server/clubState";
import { getMember, joinClub, leaveClub, membersKey, userClubsKey, syncMemberships, listMembers } from "../lib/server/members";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const OLD = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const reg = makeRegistry(parseAssets([
  { chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." },
  { chainId: 10143, address: OLD, kind: "erc721", name: "O", symbol: "O", status: "verified", note: "Why.", club: "archived" },
]));
const club = reg.clubFor(NFT)!;
const archived = reg.clubFor(OLD)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const noHold = async () => [0n];
const holding = async () => [1n];

/** A member: signed up with a wallet, optionally with a shared profile (needed to post), joined. */
async function member(store: Store, userId: string, n: number, opts: { profile?: boolean; holder?: boolean; entry?: typeof club } = {}) {
  const w = wallet(n);
  if (opts.profile !== false) {
    await store.set(profileKey(w), { provider: "twitter", handle: `h${n}`, userId, updatedAt: 1 });
    await store.setMembers(userWalletsKey(userId), [w]);
  }
  const r = await joinClub(store, opts.entry ?? club, userId, [w], { holdings: opts.holder ? holding : noHold });
  assert.ok(r.ok, `${userId} joins`);
  return { userId, wallet: w } satisfies Actor;
}
/** The cooldown and hourly limits use the real clock; tests that post more than once clear them. */
const reset = (store: Store, userId: string) => store.del(`declub:rl:club-post-cd:${token}:${userId}`, `declub:rl:club-post-hr:${token}:${userId}`);
const say = async (store: Store, userId: string, text = "hello", kind = "note", deps: Deps = {}) => {
  await reset(store, userId);
  return createPost(store, club, userId, { kind, text }, deps);
};
const posted = async (store: Store, userId: string, text = "hello") => {
  const r = await say(store, userId, text);
  assert.ok(r.ok, JSON.stringify(r));
  return r.post.id;
};
/** An Owner (user "own"), a Moderator ("mod"), a member ("m1", "m2") and an app admin id ("adm"). */
async function club1() {
  const store = memoryStore();
  const own = await member(store, "own", 1);
  const mod = await member(store, "mod", 2);
  const m1 = await member(store, "m1", 3);
  const m2 = await member(store, "m2", 4);
  await saveRoles(store, token, { owner: "own", moderators: ["mod"] });
  return { store, own, mod, m1, m2, deps: { admins: new Set(["adm"]) } satisfies Deps, adm: { userId: "adm", wallet: wallet(99) } };
}

describe("createPost", () => {
  it("posts as the member's Club wallet, and the author never sees anyone's user id", async () => {
    const { store } = await club1();
    const r = await say(store, "m1", "  WTB a Chog  ", "looking");
    assert.ok(r.ok);
    assert.equal(r.post.text, "WTB a Chog");
    assert.equal(r.post.wallet, wallet(3));
    assert.equal(r.post.mine, true);
    assert.ok(!JSON.stringify(r.post).includes("m1"));
  });

  it("needs membership, and no ban", async () => {
    const { store, mod, deps } = await club1();
    assert.deepEqual(await createPost(store, club, "stranger", { kind: "note", text: "hi" }), { ok: false, reason: "not_member" });
    await banUser(store, club, mod, { wallet: wallet(3) }, false, deps);
    assert.deepEqual(await createPost(store, club, "m1", { kind: "note", text: "hi" }), { ok: false, reason: "not_member" }, "a banned user also left");
  });

  it("refuses a banned user who is somehow still a member", async () => {
    const { store, deps, mod } = await club1();
    await banUser(store, club, mod, { wallet: wallet(3) }, false, deps);
    // Put the row back, as a race between a ban and a join would.
    await store.set(`declub:club-member:10143:${token}:m1`, { userId: "m1", wallets: [wallet(3)], displayWallet: wallet(3), holder: false, holderCheckedAt: 1, joinedAt: 1 });
    assert.deepEqual(await createPost(store, club, "m1", { kind: "note", text: "hi" }), { ok: false, reason: "banned" });
  });

  it("needs a shared verified profile", async () => {
    const store = memoryStore();
    await member(store, "plain", 5, { profile: false });
    assert.deepEqual(await createPost(store, club, "plain", { kind: "note", text: "hi" }), { ok: false, reason: "no_profile" });
  });

  it("refuses an archived Club", async () => {
    const store = memoryStore();
    assert.deepEqual(await createPost(store, archived, "x", { kind: "note", text: "hi" }), { ok: false, reason: "archived" });
  });

  it("validates kind, text, and link-only-on-looking", async () => {
    const { store } = await club1();
    await reset(store, "m1");
    assert.deepEqual(await createPost(store, club, "m1", { kind: "shout", text: "x" }), { ok: false, reason: "bad_kind" });
    assert.deepEqual(await createPost(store, club, "m1", { kind: "note", text: "   " }), { ok: false, reason: "empty" });
    assert.deepEqual(await createPost(store, club, "m1", { kind: "note", text: "a".repeat(POST_MAX + 1) }), { ok: false, reason: "too_long" });
    assert.deepEqual(await createPost(store, club, "m1", { kind: "note", text: "x", link: "5" }), { ok: false, reason: "bad_link" }, "a note can't carry a link");
    assert.deepEqual(await createPost(store, club, "m1", { kind: "looking", text: "x", link: "nope" }), { ok: false, reason: "bad_link" });
  });

  it("checks a linked deal or swap exists and names this Club's token", async () => {
    const { store } = await club1();
    const seen: PostLink[] = [];
    const resolve = (tokens: string[] | null) => async (link: PostLink) => (seen.push(link), tokens);
    await reset(store, "m1");
    assert.deepEqual(await createPost(store, club, "m1", { kind: "looking", text: "x", link: "7" }, { resolveLink: resolve(null) }), { ok: false, reason: "link_not_found" });
    assert.deepEqual(await createPost(store, club, "m1", { kind: "looking", text: "x", link: "7" }, { resolveLink: resolve([OLD.toLowerCase()]) }), { ok: false, reason: "link_mismatch" });
    const failing = async () => { throw new Error("down"); };
    assert.deepEqual(await createPost(store, club, "m1", { kind: "looking", text: "x", link: "7" }, { resolveLink: failing }), { ok: false, reason: "link_unavailable" });
    const ok = await createPost(store, club, "m1", { kind: "looking", text: "x", link: "7" }, { resolveLink: resolve(["0xother", token]) });
    assert.ok(ok.ok);
    assert.deepEqual(ok.post.link, { kind: "deal", id: "7" });
    assert.deepEqual(seen[0], { kind: "deal", id: "7" });
    // Refused posts used no cooldown: the accepted one went through right after.
  });

  it("holds a cooldown between posts and an hourly cap, counted per Club and user", async () => {
    const { store } = await club1();
    await reset(store, "m1");
    assert.ok((await createPost(store, club, "m1", { kind: "note", text: "1" })).ok);
    assert.deepEqual(await createPost(store, club, "m1", { kind: "note", text: "2" }), { ok: false, reason: "cooldown" });
    // Take the cooldown away each time: only the hourly cap is left.
    for (let i = 1; i < POSTS_PER_HOUR; i++) {
      await store.del(`declub:rl:club-post-cd:${token}:m1`);
      const r = await createPost(store, club, "m1", { kind: "note", text: `n${i}` });
      assert.ok(r.ok, `post ${i + 1}: ${JSON.stringify(r)}`);
    }
    await store.del(`declub:rl:club-post-cd:${token}:m1`);
    assert.deepEqual(await createPost(store, club, "m1", { kind: "note", text: "one too many" }), { ok: false, reason: "rate_limited" });
    assert.ok((await say(store, "m2")).ok, "another member is unaffected");
  });

  it("limits posting to holders when the Owner says so, except for staff", async () => {
    const { store, own, deps } = await club1();
    await updateProfile(store, club, own, { holdersOnlyPosts: true }, deps);
    assert.deepEqual(await say(store, "m1"), { ok: false, reason: "holders_only" });
    assert.ok((await say(store, "mod")).ok, "a Moderator may still post");
    assert.ok((await say(store, "own")).ok);
    await member(store, "h1", 7, { holder: true });
    assert.ok((await say(store, "h1")).ok, "a holder may");
  });
});

describe("listPosts", () => {
  it("lists newest first with pinned on top, and skips deleted posts", async () => {
    const { store, own, deps } = await club1();
    const a = await posted(store, "m1", "first");
    await new Promise((r) => setTimeout(r, 3));
    const b = await posted(store, "m2", "second");
    await new Promise((r) => setTimeout(r, 3));
    const c = await posted(store, "m1", "third");
    assert.deepEqual((await listPosts(store, club, {}, deps)).posts.map((p) => p.text), ["third", "second", "first"]);
    await pinPost(store, club, own, a, true, deps);
    assert.deepEqual((await listPosts(store, club, {}, deps)).posts.map((p) => [p.text, p.pinned]), [["first", true], ["third", false], ["second", false]]);
    await deletePost(store, club, { userId: "m2", wallet: wallet(4) }, b, deps);
    assert.deepEqual((await listPosts(store, club, {}, deps)).posts.map((p) => p.id), [a, c]);
  });

  it("tells the viewer their role, and nothing to a visitor", async () => {
    const { store, deps } = await club1();
    assert.equal((await listPosts(store, club, {}, deps)).role, null);
    assert.equal((await listPosts(store, club, { userId: "mod" }, deps)).role, "moderator");
    assert.equal((await listPosts(store, club, { userId: "adm" }, deps)).role, "admin");
  });
});

describe("likes", () => {
  it("counts a member once, marks it for them, and lets them take it back", async () => {
    const { store, deps } = await club1();
    const id = await posted(store, "m1", "gm");
    assert.deepEqual(await likePost(store, club, "m2", id, true), { ok: true, likes: 1 });
    assert.deepEqual(await likePost(store, club, "m2", id, true), { ok: true, likes: 1 }, "the same member again adds nothing");
    assert.deepEqual(await likePost(store, club, "mod", id, true), { ok: true, likes: 2 });
    const asM2 = (await listPosts(store, club, { userId: "m2" }, deps)).posts[0]!;
    assert.deepEqual([asM2.likes, asM2.liked], [2, true]);
    const asVisitor = (await listPosts(store, club, {}, deps)).posts[0]!;
    assert.deepEqual([asVisitor.likes, asVisitor.liked], [2, false]);
    assert.deepEqual(await likePost(store, club, "m2", id, false), { ok: true, likes: 1 });
    assert.equal((await listPosts(store, club, { userId: "m2" }, deps)).posts[0]!.liked, false);
  });

  it("refuses non-members, bans, your own post, a hidden post, a missing one and an archived Club", async () => {
    const { store, mod, deps } = await club1();
    const id = await posted(store, "m1");
    assert.deepEqual(await likePost(store, club, "stranger", id, true), { ok: false, reason: "not_member" });
    assert.deepEqual(await likePost(store, club, "m1", id, true), { ok: false, reason: "own_like" });
    assert.deepEqual(await likePost(store, club, "m2", "0".repeat(32), true), { ok: false, reason: "not_found" });
    await hidePost(store, club, mod, id, true, deps);
    assert.deepEqual(await likePost(store, club, "m2", id, true), { ok: false, reason: "hidden" });
    const other = await posted(store, "m1", "again");
    await banUser(store, club, mod, { wallet: wallet(4) }, false, deps);
    assert.deepEqual(await likePost(store, club, "m2", other, true), { ok: false, reason: "not_member" }, "a banned member has been removed");
    assert.deepEqual(await likePost(store, archived, "m2", other, true), { ok: false, reason: "archived" });
  });

  it("goes with the post when it is deleted", async () => {
    const { store, m1, deps } = await club1();
    const id = await posted(store, "m1");
    await likePost(store, club, "m2", id, true);
    await deletePost(store, club, m1, id, deps);
    assert.equal(await store.countMembers(`declub:club-likes:10143:${token}:${id}`), 0);
  });
});

describe("the Club inbox", () => {
  it("tells an author about likes (a new count is new news) and a pin, and only about their own posts", async () => {
    const { store, own, deps } = await club1();
    const id = await posted(store, "m1", "gm Chogs");
    await posted(store, "m2", "someone else's");
    const mine = () => clubInbox(store, "m1", [wallet(3)], { registry: reg, standings: async () => null });
    assert.deepEqual(await mine(), [], "nothing yet");

    await likePost(store, club, "m2", id, true);
    const one = await mine();
    assert.deepEqual(one.map((i) => i.kind), ["club-like"]);
    assert.match(one[0]!.title, /^Someone liked your post/);
    assert.equal(one[0]!.href, `/clubs/${token}?tab=board`);

    await likePost(store, club, "mod", id, true);
    const two = await mine();
    assert.match(two[0]!.title, /^2 members liked/);
    assert.notEqual(two[0]!.key, one[0]!.key, "a new like is a new notification");

    await pinPost(store, club, own, id, true, deps);
    assert.deepEqual((await mine()).map((i) => i.kind).sort(), ["club-like", "club-pinned"]);
    assert.deepEqual(await clubInbox(store, "m2", [wallet(4)], { registry: reg, standings: async () => null }), [], "another member's likes and pins are theirs");
  });

  it("forgets posts older than two weeks and hidden ones", async () => {
    const { store, mod, deps } = await club1();
    const id = await posted(store, "m1", "old news");
    await likePost(store, club, "m2", id, true);
    assert.equal((await clubInbox(store, "m1", [wallet(3)], { registry: reg, standings: async () => null, now: () => Date.now() + 15 * 86_400_000 })).length, 0);
    await hidePost(store, club, mod, id, true, deps);
    assert.equal((await clubInbox(store, "m1", [wallet(3)], { registry: reg, standings: async () => null })).length, 0);
  });
});

describe("the Club inbox: replies and standings", () => {
  it("tells an author about replies from others, a new count being new news", async () => {
    const { store } = await club1();
    const id = await posted(store, "m1", "gm Chogs");
    const mine = () => clubInbox(store, "m1", [wallet(3)], { registry: reg, standings: async () => null });
    await createReply(store, club, "m1", id, { text: "my own reply" });
    assert.deepEqual(await mine(), [], "their own reply isn't news");
    await createReply(store, club, "m2", id, { text: "nice" });
    const one = await mine();
    assert.deepEqual(one.map((i) => i.kind), ["club-reply"]);
    assert.match(one[0]!.title, /^A reply to your post/);
  });

  const row = (i: number, over: Partial<StandingRow> = {}): StandingRow => ({ wallet: wallet(i), rank: i, shares: String(20 - i), joinedAt: i, days: 0, xShares: 0, points: 0, bonusBps: 0, streak: 0, ...(i <= 10 ? { estimate: "1000000000000000000" } : {}), ...over });
  const standings = (over: Partial<ClubStandings> = {}): ClubStandings => ({
    club: token, n: 3, start: 0, endsAt: 1_000_000, computedAt: 100, fees: "1", holderPool: "10", fundPool: "1",
    rows: Array.from({ length: 12 }, (_, i) => row(i + 1)), activity: {}, ...over,
  });

  it("says where a Holder stands, in or out of the paid places, keyed by which", () => {
    const [inside] = standingsNews(standings(), "N", new Set([wallet(4)]), 0);
    assert.equal(inside!.key, `club-rank:${token}:3:in`);
    assert.match(inside!.title, /#4/);
    const [outside] = standingsNews(standings(), "N", new Set([wallet(12)]), 0);
    assert.equal(outside!.key, `club-rank:${token}:3:out`);
    assert.match(outside!.body, /^3 more NFTs/, "10th holds 10 and joined earlier: 8 needs 3");
    assert.deepEqual(standingsNews(standings({ holderPool: "0" }), "N", new Set([wallet(4)]), 0), [], "no pool, no race");
  });

  it("nudges in the epoch's last day: to post, or to keep a streak", () => {
    const late = (1_000_000 - 3_600) * 1000;
    const news = standingsNews(standings({ rows: [row(1, { days: 2 })] }), "N", new Set([wallet(1)]), late);
    const closing = news.find((i) => i.kind === "club-closing")!;
    assert.match(closing.body, /active 2 of 7 days/);
    assert.equal(standingsNews(standings({ rows: [row(1, { days: 2 })] }), "N", new Set([wallet(1)]), 0).filter((i) => i.kind === "club-closing").length, 0, "not before the last day");
    const streak = standingsNews(standings({ rows: [], activity: { [wallet(5)]: { days: 2, streak: 0, carried: 4 } } }), "N", new Set([wallet(5)]), late);
    assert.match(streak[0]!.body, /today to keep your 4-week streak/);
  });
});

describe("reports", () => {
  it("hides a post at three distinct reports, never counting one member twice", async () => {
    const { store, deps } = await club1();
    const id = await posted(store, "m1", "scam");
    const reporters = [await member(store, "r1", 11, { holder: true }), await member(store, "r2", 12, { holder: true }), await member(store, "r3", 13, { holder: true })];
    assert.deepEqual(await reportPost(store, club, "r1", id, deps), { ok: true, hidden: false });
    assert.deepEqual(await reportPost(store, club, "r1", id, deps), { ok: true, hidden: false }, "the same member again adds nothing");
    assert.deepEqual(await reportPost(store, club, "r2", id, deps), { ok: true, hidden: false });
    assert.equal(REPORTS_TO_HIDE, 3);
    assert.deepEqual(await reportPost(store, club, reporters[2]!.userId, id, deps), { ok: true, hidden: true });
    const asOther = (await listPosts(store, club, { userId: "m2" }, deps)).posts[0]!;
    assert.equal(asOther.text, null);
    assert.equal(asOther.hidden, "reports");
    assert.equal((await listPosts(store, club, { userId: "m1" }, deps)).posts[0]!.text, "scam", "the author still sees it");
    const asMod = (await listPosts(store, club, { userId: "mod" }, deps)).posts[0]!;
    assert.equal(asMod.text, "scam");
    assert.equal(asMod.reports, 3);
    assert.equal((await readLog(store, token))[0]!.action, "auto_hide");
  });

  it("refuses non-members, banned users, your own post, a missing post and an archived Club", async () => {
    const { store, deps } = await club1();
    const id = await posted(store, "m1");
    assert.deepEqual(await reportPost(store, club, "stranger", id, deps), { ok: false, reason: "not_member" });
    assert.deepEqual(await reportPost(store, club, "m1", id, deps), { ok: false, reason: "own_post" });
    assert.deepEqual(await reportPost(store, club, "m2", "0".repeat(32), deps), { ok: false, reason: "not_found" });
    assert.deepEqual(await reportPost(store, club, "m2", "not-an-id", deps), { ok: false, reason: "not_found" });
    assert.deepEqual(await reportPost(store, archived, "m2", id, deps), { ok: false, reason: "archived" });
  });

  it("limits how many reports a member files a day", async () => {
    const { store, deps } = await club1();
    const ids = [];
    for (let i = 0; i < REPORTS_PER_DAY + 1; i++) {
      await reset(store, "m1");
      const r = await createPost(store, club, "m1", { kind: "note", text: `p${i}` });
      assert.ok(r.ok);
      ids.push(r.post.id);
    }
    for (let i = 0; i < REPORTS_PER_DAY; i++) assert.ok((await reportPost(store, club, "m2", ids[i]!, deps)).ok, `report ${i + 1}`);
    assert.deepEqual(await reportPost(store, club, "m2", ids[REPORTS_PER_DAY]!, deps), { ok: false, reason: "rate_limited" });
  });

  it("a Moderator's restore clears the reports, so a post isn't hidden again by the old ones", async () => {
    const { store, mod, deps } = await club1();
    const id = await posted(store, "m1");
    for (const [u, n] of [["r1", 11], ["r2", 12], ["r3", 13]] as const) {
      await member(store, u, n, { holder: true });
      await reportPost(store, club, u, id, deps);
    }
    assert.ok((await hidePost(store, club, mod, id, false, deps)).ok);
    assert.equal((await listPosts(store, club, { userId: "m2" }, deps)).posts[0]!.hidden, null);
    assert.equal((await listPosts(store, club, { userId: "mod" }, deps)).posts[0]!.reports, undefined, "no reports left to show");
    await member(store, "r4", 14, { holder: true });
    assert.deepEqual(await reportPost(store, club, "r4", id, deps), { ok: true, hidden: false }, "one new report is not three");
  });
});

describe("who reports count", () => {
  it("counts only Holders' and staff's reports toward hiding, but shows staff every report", async () => {
    const { store, deps } = await club1();
    const id = await posted(store, "m1", "contested");
    for (const [u, n] of [["f1", 31], ["f2", 32], ["f3", 33], ["f4", 34]] as const) {
      await member(store, u, n);
      assert.deepEqual(await reportPost(store, club, u, id, deps), { ok: true, hidden: false }, `${u} isn't a Holder`);
    }
    assert.equal((await listPosts(store, club, { userId: "m2" }, deps)).posts[0]!.reports, undefined, "members don't see counts");
    const asMod = (await listPosts(store, club, { userId: "mod" }, deps)).posts[0]!;
    assert.equal(asMod.hidden, null);
    assert.equal(asMod.reports, 4, "staff see reports on a post that is still up");

    await member(store, "h1", 35, { holder: true });
    await member(store, "h2", 36, { holder: true });
    assert.deepEqual(await reportPost(store, club, "h1", id, deps), { ok: true, hidden: false });
    assert.deepEqual(await reportPost(store, club, "h2", id, deps), { ok: true, hidden: false });
    // A Moderator's report counts like a Holder's: they could hide it themselves anyway.
    assert.deepEqual(await reportPost(store, club, "mod", id, deps), { ok: true, hidden: true });
    assert.equal((await listPosts(store, club, { userId: "mod" }, deps)).posts[0]!.reports, 7);
  });

  it("never hides a post by the Owner, a Moderator or an admin", async () => {
    const { store, deps } = await club1();
    await member(store, "adm", 99);
    const ids = [await posted(store, "own", "owner"), await posted(store, "mod", "moderator"), await posted(store, "adm", "admin")];
    for (const [u, n] of [["h1", 41], ["h2", 42], ["h3", 43], ["h4", 44]] as const) {
      await member(store, u, n, { holder: true });
      for (const id of ids) assert.deepEqual(await reportPost(store, club, u, id, deps), { ok: true, hidden: false });
    }
    const seen = (await listPosts(store, club, { userId: "own" }, deps)).posts;
    assert.deepEqual(seen.map((p) => p.hidden), [null, null, null]);
    assert.deepEqual(seen.map((p) => p.reports), [4, 4, 4], "the reports still reach staff");
  });
});

describe("moderating posts", () => {
  it("keeps the pin on a post that reports hid, shows it unpinned until restored, then pinned again", async () => {
    const { store, own, mod, deps } = await club1();
    const id = await posted(store, "m1", "pinned");
    await posted(store, "m2", "newer");
    await pinPost(store, club, own, id, true, deps);
    for (const [u, n] of [["r1", 11], ["r2", 12], ["r3", 13]] as const) {
      await member(store, u, n, { holder: true });
      await reportPost(store, club, u, id, deps);
    }
    assert.deepEqual((await loadProfile(store, token)).pinned, [id], "the pin is kept");
    const asMember = (await listPosts(store, club, { userId: "m2" }, deps)).posts;
    assert.deepEqual(asMember.find((p) => p.id === id), { ...asMember.find((p) => p.id === id)!, text: null, pinned: false }, "not shown as pinned while hidden");
    assert.equal((await listPosts(store, club, { userId: "own" }, deps)).posts[0]!.pinned, true, "staff see it is still pinned");

    assert.ok((await hidePost(store, club, mod, id, false, deps)).ok);
    const restored = (await listPosts(store, club, { userId: "m2" }, deps)).posts;
    assert.deepEqual(restored.map((p) => [p.text, p.pinned]), [["pinned", true], ["newer", false]]);
  });

  it("lets staff hide and restore a member's post, logged", async () => {
    const { store, mod, deps } = await club1();
    const id = await posted(store, "m1");
    assert.ok((await hidePost(store, club, mod, id, true, deps)).ok);
    assert.equal((await listPosts(store, club, { userId: "m2" }, deps)).posts[0]!.hidden, "moderator");
    assert.ok((await hidePost(store, club, mod, id, false, deps)).ok);
    assert.deepEqual((await readLog(store, token)).map((l) => l.action), ["restore_post", "hide_post"]);
    assert.equal((await readLog(store, token))[0]!.actor, mod.wallet);
  });

  it("keeps a Moderator off the Owner's and other Moderators' posts, but not the Owner or an admin", async () => {
    const { store, own, mod, deps, adm } = await club1();
    const other = await member(store, "mod2", 21);
    await saveRoles(store, token, { owner: "own", moderators: ["mod", "mod2"] });
    const byOwner = await posted(store, "own");
    const byMod2 = await posted(store, "mod2");
    assert.deepEqual(await hidePost(store, club, mod, byOwner, true, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await hidePost(store, club, mod, byMod2, true, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await deletePost(store, club, mod, byMod2, deps), { ok: false, reason: "forbidden" });
    assert.ok((await hidePost(store, club, own, byMod2, true, deps)).ok);
    assert.ok((await hidePost(store, club, adm, byOwner, true, deps)).ok);
    assert.equal(other.userId, "mod2");
  });

  it("refuses a plain member, and a missing post", async () => {
    const { store, m1, m2, deps } = await club1();
    const id = await posted(store, "m1");
    assert.deepEqual(await hidePost(store, club, m2, id, true, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await deletePost(store, club, m2, id, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await deletePost(store, club, m1, "f".repeat(32), deps), { ok: false, reason: "not_found" });
  });

  it("lets an author delete their own post, unlogged, and staff delete another's, logged and unpinned", async () => {
    const { store, own, mod, m1, deps } = await club1();
    const mine = await posted(store, "m1", "mine");
    assert.ok((await deletePost(store, club, m1, mine, deps)).ok);
    assert.equal(await store.get(postKey(token, mine)), null);
    assert.deepEqual(await readLog(store, token), []);

    const theirs = await posted(store, "m1", "theirs");
    await pinPost(store, club, own, theirs, true, deps);
    assert.ok((await deletePost(store, club, mod, theirs, deps)).ok);
    assert.deepEqual((await loadProfile(store, token)).pinned, []);
    assert.deepEqual((await readLog(store, token)).map((l) => l.action), ["delete_post", "pin_post"]);
  });
});

describe("pins", () => {
  it("lets only the Owner or an admin pin, at most three, never a hidden post", async () => {
    const { store, own, mod, m1, deps, adm } = await club1();
    const ids = [];
    for (let i = 0; i < MAX_PINNED + 1; i++) ids.push(await posted(store, "m1", `p${i}`));
    assert.deepEqual(await pinPost(store, club, mod, ids[0]!, true, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await pinPost(store, club, m1, ids[0]!, true, deps), { ok: false, reason: "forbidden" });
    for (let i = 0; i < MAX_PINNED; i++) assert.ok((await pinPost(store, club, i === 2 ? adm : own, ids[i]!, true, deps)).ok);
    assert.deepEqual(await pinPost(store, club, own, ids[3]!, true, deps), { ok: false, reason: "too_many_pinned" });
    assert.ok((await pinPost(store, club, own, ids[0]!, true, deps)).ok, "pinning a pinned post is a no-op");
    assert.deepEqual((await loadProfile(store, token)).pinned, [ids[0], ids[1], ids[2]]);
    assert.ok((await pinPost(store, club, own, ids[0]!, false, deps)).ok);
    assert.ok((await pinPost(store, club, own, ids[3]!, true, deps)).ok);
    await hidePost(store, club, own, ids[3]!, true, deps);
    assert.ok(!(await loadProfile(store, token)).pinned.includes(ids[3]!), "hiding a pinned post unpins it");
    assert.deepEqual(await pinPost(store, club, own, ids[3]!, true, deps), { ok: false, reason: "hidden" });
    const hiddenOne = await posted(store, "m1", "hide me");
    await hidePost(store, club, own, hiddenOne, true, deps);
    assert.deepEqual(await pinPost(store, club, own, hiddenOne, true, deps), { ok: false, reason: "hidden" });
    assert.deepEqual(await pinPost(store, club, own, "e".repeat(32), true, deps), { ok: false, reason: "not_found" });
  });
});

describe("bans", () => {
  it("bans a member by wallet: they leave, lose any role, can't rejoin, and the ban is listed and logged", async () => {
    const { store, mod, deps } = await club1();
    const r = await banUser(store, club, mod, { wallet: wallet(3).toUpperCase().replace("0X", "0x") }, false, deps);
    assert.deepEqual(r, { ok: true, wallet: wallet(3) });
    assert.equal(await getMember(store, token, "m1"), null);
    assert.deepEqual(await store.members(membersKey(token)).then((m) => m.sort()), ["mod", "m2", "own"].sort());
    assert.deepEqual(await joinClub(store, club, "m1", [wallet(3)]), { ok: false, reason: "banned" });
    const bans = await listBans(store, club, "mod", deps);
    assert.deepEqual(bans?.club.map((b) => b.wallet), [wallet(3)]);
    assert.deepEqual(bans?.everywhere, []);
    assert.equal((await readLog(store, token))[0]!.action, "ban");
  });

  it("bans a post's author, even one who left", async () => {
    const { store, mod, m1, deps } = await club1();
    const id = await posted(store, "m1");
    await leaveClub(store, token, m1.userId);
    assert.deepEqual(await banUser(store, club, mod, { post: id }, false, deps), { ok: true, wallet: wallet(3) });
    assert.deepEqual(await joinClub(store, club, "m1", [wallet(3)]), { ok: false, reason: "banned" });
  });

  it("follows the permission matrix, and nobody bans themselves", async () => {
    const { store, own, mod, m1, deps, adm } = await club1();
    // An admin outranks everyone, so only the self-ban rule stops them.
    const adminMember = await member(store, "adm", 99);
    assert.deepEqual(await banUser(store, club, adminMember, { wallet: wallet(99) }, false, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await banUser(store, club, m1, { wallet: wallet(4) }, false, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await banUser(store, club, mod, { wallet: wallet(1) }, false, deps), { ok: false, reason: "forbidden" }, "Moderator can't ban the Owner");
    assert.deepEqual(await banUser(store, club, own, { wallet: wallet(1) }, false, deps), { ok: false, reason: "forbidden" }, "nor can the Owner ban themselves");
    assert.deepEqual(await banUser(store, club, mod, { wallet: wallet(2) }, false, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await banUser(store, club, own, { wallet: wallet(98) }, false, deps), { ok: false, reason: "not_found" });
    const ownerBan = await banUser(store, club, adm, { wallet: wallet(1) }, false, deps);
    assert.deepEqual(ownerBan, { ok: true, wallet: wallet(1) }, "only an admin can ban the Owner");
    assert.equal((await loadRoles(store, token)).owner, undefined, "and the Owner loses the role");
    assert.ok((await banUser(store, club, own, { wallet: wallet(2) }, false, deps)).ok === false, "a banned ex-Owner holds no power");
  });

  it("lets only an admin ban everywhere, which removes the user from every Club", async () => {
    const { store, own, deps, adm } = await club1();
    await joinClub(store, archived, "m1", [wallet(3)]).catch(() => null);
    await store.addMember(userClubsKey("m1"), OLD.toLowerCase());
    assert.deepEqual(await banUser(store, club, own, { wallet: wallet(3) }, true, deps), { ok: false, reason: "forbidden" });
    assert.ok((await banUser(store, club, adm, { wallet: wallet(3) }, true, deps)).ok);
    assert.deepEqual(await store.members(userClubsKey("m1")), []);
    assert.deepEqual(await joinClub(store, club, "m1", [wallet(3)]), { ok: false, reason: "banned" });
    assert.deepEqual((await listBans(store, club, "own", deps))?.everywhere, [], "the Owner doesn't see global bans");
    assert.deepEqual((await listBans(store, club, "adm", deps))?.everywhere.map((b) => b.wallet), [wallet(3)]);
  });

  it("lifts a ban without putting the user back; a global ban only by an admin", async () => {
    const { store, own, mod, deps, adm } = await club1();
    await banUser(store, club, mod, { wallet: wallet(3) }, false, deps);
    assert.deepEqual(await unbanUser(store, club, { userId: "m2", wallet: wallet(4) }, wallet(3), false, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await unbanUser(store, club, own, wallet(77), false, deps), { ok: false, reason: "not_found" });
    assert.ok((await unbanUser(store, club, own, wallet(3), false, deps)).ok);
    assert.deepEqual(await loadBans(store, token), {});
    assert.equal(await getMember(store, token, "m1"), null);
    assert.ok((await joinClub(store, club, "m1", [wallet(3)])).ok);

    await banUser(store, club, adm, { wallet: wallet(4) }, true, deps);
    assert.deepEqual(await unbanUser(store, club, own, wallet(4), true, deps), { ok: false, reason: "forbidden" });
    assert.ok((await unbanUser(store, club, adm, wallet(4), true, deps)).ok);
  });

  it("takes at least the banner's rank to lift a ban; older bans without one count as the Owner's", async () => {
    const { store, own, mod, deps, adm } = await club1();
    await banUser(store, club, own, { wallet: wallet(3) }, false, deps);
    assert.equal((await loadBans(store, token)).m1?.role, "owner");
    assert.deepEqual(await unbanUser(store, club, mod, wallet(3), false, deps), { ok: false, reason: "forbidden" }, "a Moderator can't lift the Owner's ban");
    assert.ok((await unbanUser(store, club, own, wallet(3), false, deps)).ok);

    await banUser(store, club, adm, { wallet: wallet(4) }, false, deps);
    assert.deepEqual(await unbanUser(store, club, own, wallet(4), false, deps), { ok: false, reason: "forbidden" }, "nor the Owner an admin's");
    assert.ok((await unbanUser(store, club, adm, wallet(4), false, deps)).ok);

    assert.ok((await joinClub(store, club, "m1", [wallet(3)], { holdings: noHold })).ok);
    assert.ok((await banUser(store, club, mod, { wallet: wallet(3) }, false, deps)).ok);
    assert.ok((await unbanUser(store, club, mod, wallet(3), false, deps)).ok, "a Moderator lifts a Moderator's ban");

    // A ban stored before the role was recorded.
    await store.set(`declub:club-ban:10143:${token}`, { m2: { wallet: wallet(4), at: 1, by: wallet(2) } });
    assert.deepEqual(await unbanUser(store, club, mod, wallet(4), false, deps), { ok: false, reason: "forbidden" });
    assert.ok((await unbanUser(store, club, own, wallet(4), false, deps)).ok);
  });

  it("names a member by their Club wallet only, never by another linked wallet", async () => {
    const { store, own, deps } = await club1();
    // m1 also links a second wallet, which the Club never shows.
    await joinClub(store, club, "m1", [wallet(3), wallet(60)], { holdings: noHold });
    assert.equal((await getMember(store, token, "m1"))?.displayWallet, wallet(3));
    assert.deepEqual(await banUser(store, club, own, { wallet: wallet(60) }, false, deps), { ok: false, reason: "not_found" });
    assert.deepEqual(await setRole(store, club, own, wallet(60), "moderator", deps), { ok: false, reason: "not_found" });
    assert.ok((await setRole(store, club, own, wallet(3), "moderator", deps)).ok);
  });

  it("shows the ban list to staff only", async () => {
    const { store, deps } = await club1();
    assert.equal(await listBans(store, club, "m1", deps), null);
    assert.equal(await listBans(store, club, "stranger", deps), null);
  });
});

describe("the Owner's claim", () => {
  const owned = (address: string | null) => ({ ownerOf: async () => address });

  it("makes a member whose wallet is owner() the Owner, case-insensitively, and records the claim", async () => {
    const store = memoryStore();
    const m = await member(store, "founder", 30);
    const r = await claimOwner(store, club, m, [wallet(31), wallet(30).toUpperCase().replace("0X", "0x")], owned(wallet(30)));
    assert.deepEqual(r, { ok: true });
    assert.equal(await roleIn(store, token, "founder"), "owner");
    assert.equal((await loadProfile(store, token)).ownerClaim?.wallet, wallet(30));
    assert.deepEqual(await claimOwner(store, club, m, [wallet(30)], owned(wallet(30))), { ok: true }, "idempotent");
    assert.equal((await readLog(store, token)).filter((l) => l.action === "claim_owner").length, 1);
  });

  it("refuses non-members, a token with no owner(), a wallet that isn't the owner, and a second claimant", async () => {
    const store = memoryStore();
    assert.deepEqual(await claimOwner(store, club, { userId: "x", wallet: "w" }, [wallet(1)], owned(wallet(1))), { ok: false, reason: "not_member" });
    const a = await member(store, "a", 40);
    const b = await member(store, "b", 41);
    assert.deepEqual(await claimOwner(store, club, a, [wallet(40)], owned(null)), { ok: false, reason: "no_owner" });
    assert.deepEqual(await claimOwner(store, club, a, [wallet(40)], owned(wallet(41))), { ok: false, reason: "not_owner" });
    assert.ok((await claimOwner(store, club, a, [wallet(40)], owned(wallet(40)))).ok);
    assert.deepEqual(await claimOwner(store, club, b, [wallet(41)], owned(wallet(41))), { ok: false, reason: "has_owner" });
  });

  it("tells an admin when owner() has changed since the claim", async () => {
    const store = memoryStore();
    const m = await member(store, "founder", 30);
    assert.equal(await ownershipCheck(store, club, owned(wallet(30))), null, "no claim yet");
    await claimOwner(store, club, m, [wallet(30)], owned(wallet(30)));
    assert.deepEqual(await ownershipCheck(store, club, owned(wallet(30))), { claimed: wallet(30), onchain: wallet(30), changed: false });
    assert.deepEqual(await ownershipCheck(store, club, owned(wallet(32))), { claimed: wallet(30), onchain: wallet(32), changed: true });
    assert.equal((await ownershipCheck(store, club, owned(null)))?.changed, true);
  });
});

describe("setRole", () => {
  it("lets the Owner appoint a Moderator by wallet, logged, and remove them", async () => {
    const { store, own, m1, deps } = await club1();
    assert.deepEqual(await setRole(store, club, own, m1.wallet, "moderator", deps), { ok: true });
    assert.equal(await roleIn(store, token, "m1", deps), "moderator");
    assert.deepEqual(await setRole(store, club, own, m1.wallet, "moderator", deps), { ok: false, reason: "no_change" });
    assert.deepEqual(await setRole(store, club, own, m1.wallet, null, deps), { ok: true });
    assert.equal(await roleIn(store, token, "m1", deps), "member");
    assert.deepEqual((await readLog(store, token)).map((l) => l.action), ["remove_moderator", "appoint_moderator"]);
  });

  it("refuses a Moderator or a member, and a wallet that isn't a member", async () => {
    const { store, mod, m1, m2, deps } = await club1();
    assert.deepEqual(await setRole(store, club, mod, m1.wallet, "moderator", deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await setRole(store, club, m1, m2.wallet, "moderator", deps), { ok: false, reason: "forbidden" });
    const { own } = await club1();
    assert.deepEqual(await setRole(store, club, { userId: "own", wallet: own.wallet }, wallet(500), "moderator", deps), { ok: false, reason: "not_found" });
  });

  it("hands ownership over, and lets an admin assign or remove the Owner", async () => {
    const { store, own, m1, deps, adm } = await club1();
    assert.deepEqual(await setRole(store, club, own, m1.wallet, "owner", deps), { ok: true });
    assert.equal(await roleIn(store, token, "m1", deps), "owner");
    assert.equal(await roleIn(store, token, "own", deps), "member", "the old Owner is a member");
    assert.deepEqual(await setRole(store, club, adm, m1.wallet, null, deps), { ok: true });
    assert.equal((await loadRoles(store, token)).owner, undefined);
    assert.deepEqual(await setRole(store, club, adm, wallet(4), "owner", deps), { ok: true });
    assert.equal(await roleIn(store, token, "m2", deps), "owner");
  });

  it("caps Moderators at ten", async () => {
    const { store, own, deps } = await club1();
    for (let i = 0; i < 9; i++) {
      const m = await member(store, `x${i}`, 100 + i);
      assert.ok((await setRole(store, club, own, m.wallet, "moderator", deps)).ok);
    }
    const extra = await member(store, "extra", 200);
    assert.deepEqual(await setRole(store, club, own, extra.wallet, "moderator", deps), { ok: false, reason: "too_many_moderators" });
  });

  it("an app admin has no Club role to give or take", async () => {
    const { store, own, deps } = await club1();
    const a = await member(store, "adm", 98);
    assert.deepEqual(await setRole(store, club, own, a.wallet, "moderator", deps), { ok: false, reason: "forbidden" });
  });
});

describe("leaving takes the role along", () => {
  it("strips a Moderator's role when they leave, and an Owner's when they go (banned, deleted or walletless)", async () => {
    const { store, deps } = await club1();
    await leaveClub(store, token, "mod");
    assert.deepEqual((await loadRoles(store, token)).moderators, []);
    await syncMemberships(store, "own", []);
    assert.equal((await loadRoles(store, token)).owner, undefined);
    assert.equal(await roleIn(store, token, "own", deps), "member");
  });
});

describe("updateProfile", () => {
  it("lets the Owner or an admin edit, merges fields, and logs it", async () => {
    const { store, own, mod, deps, adm } = await club1();
    const r = await updateProfile(store, club, own, { description: "About us", links: ["https://x.com/chog"] }, deps);
    assert.ok(r.ok);
    assert.equal(r.profile.description, "About us");
    const next = await updateProfile(store, club, adm, { holdersOnlyPosts: true }, deps);
    assert.ok(next.ok);
    assert.deepEqual({ d: next.profile.description, l: next.profile.links, h: next.profile.holdersOnlyPosts }, { d: "About us", l: ["https://x.com/chog"], h: true });
    assert.deepEqual(await updateProfile(store, club, mod, { description: "x" }, deps), { ok: false, reason: "forbidden" });
    assert.deepEqual((await readLog(store, token)).map((l) => l.action), ["edit_profile", "edit_profile"]);
  });

  it("explains an invalid edit, and refuses an archived Club", async () => {
    const { store, own, deps } = await club1();
    const bad = await updateProfile(store, club, own, { links: ["http://insecure.io"] }, deps);
    assert.equal(bad.ok, false);
    assert.equal(!bad.ok && bad.reason, "invalid");
    assert.match((!bad.ok && bad.message) || "", /https/);
    assert.deepEqual(await updateProfile(store, archived, own, { description: "x" }, { admins: new Set(["own"]) }), { ok: false, reason: "archived" });
  });

  it("sets whether the Club's memecoin makes Holders, and moves `at` only when the rule changes", async () => {
    const { store, own, deps } = await club1();
    const COIN = "0xd300f095f456D59AAc122B0100833fE195136F6c";
    const paired = makeRegistry(parseAssets([
      { chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." },
      { chainId: 10143, address: COIN, kind: "erc20", category: "memecoin", name: "C", symbol: "C", status: "verified", note: "Why.", club: NFT, minHolding: "100" },
    ])).clubFor(NFT)!;
    const at = (t: number) => ({ ...deps, now: () => t });

    const off = await updateProfile(store, paired, own, { coinHolders: { on: false } }, at(10));
    assert.deepEqual(off.ok && off.profile.coinHolders, { on: false, min: "100", at: 10 }, "keeps the list's minimum");
    const same = await updateProfile(store, paired, own, { coinHolders: { on: false, min: "100" } }, at(20));
    assert.equal(same.ok && same.profile.coinHolders?.at, 10, "nothing changed, nobody is re-checked");
    const raised = await updateProfile(store, paired, own, { coinHolders: { on: true, min: "5000" } }, at(30));
    assert.deepEqual(raised.ok && raised.profile.coinHolders, { on: true, min: "5000", at: 30 });

    const none = await updateProfile(store, club, own, { coinHolders: { on: true } }, deps);
    assert.equal(!none.ok && none.message, "This Club has no memecoin.");
  });
});

describe("the leaderboard shows roles", () => {
  it("marks the Owner and Moderators, and nobody else", async () => {
    const { store, deps } = await club1();
    const view = await listMembers(store, club, [], "new", Math.floor(Date.now() / 1000), { holdings: noHold });
    const roleOfWallet = Object.fromEntries(view.members.map((m) => [m.wallet, m.role]));
    assert.equal(roleOfWallet[wallet(1)], "owner");
    assert.equal(roleOfWallet[wallet(2)], "moderator");
    assert.equal(roleOfWallet[wallet(3)], undefined);
    assert.ok(deps);
  });
});

describe("purgeClub", () => {
  it("deletes everything stored for the Club, and members' pointers to it, and nothing else", async () => {
    const { store, own, deps } = await club1();
    const id = await posted(store, "m1");
    await pinPost(store, club, own, id, true, deps);
    await banUser(store, club, own, { wallet: wallet(4) }, false, deps);
    await store.rank(activityKey(token), [{ member: "{}", score: 1 }], 10);
    await joinClub(store, archived, "m1", [wallet(3)]).catch(() => null);
    await store.addMember(userClubsKey("m1"), OLD.toLowerCase());
    await store.set(streaksKey(token), { m1: { n: 0, count: 1 } });
    await store.addMember(activeKey(token, 0), "m1:1:x");

    assert.deepEqual(await purgeClub(store, token, { now: () => (REWARDS_GENESIS + 86_400) * 1000 }), { members: 3, posts: 1 });
    assert.equal(await store.get(streaksKey(token)), null);
    assert.deepEqual(await store.members(activeKey(token, 0)), []);
    assert.deepEqual(await store.members(membersKey(token)), []);
    assert.deepEqual(await store.members(userClubsKey("m1")), [OLD.toLowerCase()], "other Clubs untouched");
    assert.equal(await store.get(postKey(token, id)), null);
    assert.deepEqual(await store.ranked(postsKey(token), 10), []);
    assert.deepEqual(await loadRoles(store, token), { moderators: [] });
    assert.deepEqual(await loadBans(store, token), {});
    assert.deepEqual(await readLog(store, token), []);
    assert.deepEqual(await store.ranked(activityKey(token), 10), []);
    assert.equal((await loadProfile(store, token)).pinned.length, 0);
  });
});
