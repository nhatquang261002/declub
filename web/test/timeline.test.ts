import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { createPost, createReply, hidePost, likePost, postKey } from "../lib/server/board";
import { saveRoles } from "../lib/server/clubState";
import { joinClub } from "../lib/server/members";
import { listTimeline, listWalletPosts } from "../lib/server/timeline";
import { walletBoardHandler } from "../lib/server/profilePageRoutes";
import type { Registry } from "../lib/verifiedAssets";
import { timelineHandler } from "../lib/server/timelineRoutes";
import { getStore, memoryStore, type Store } from "../lib/server/store";
import { estimateHeight, parseCursor, toColumns } from "../lib/timeline";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const A = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const B = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const C = "0x5A6Df0d7C2F9f0F9f1E0F3B1f2F9B6c1A2d3e4F5";
const entries = (cArchived: boolean) =>
  parseAssets([
    { chainId: 10143, address: A, kind: "erc721", name: "A", symbol: "A", status: "verified", note: "Why." },
    { chainId: 10143, address: B, kind: "erc721", name: "B", symbol: "B", status: "verified", note: "Why." },
    { chainId: 10143, address: C, kind: "erc721", name: "C", symbol: "C", status: "verified", note: "Why.", ...(cArchived ? { club: "archived" } : {}) },
  ]);
const live = makeRegistry(entries(false));
const frozen = makeRegistry(entries(true));
const club = (token: string) => live.clubFor(token)!;
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const noHold = async () => [0n];

/** A member of each of `clubs`, with a shared profile (needed to post). */
async function member(store: Store, userId: string, n: number, clubs: string[]) {
  const w = wallet(n);
  await store.set(profileKey(w), { provider: "twitter", handle: `h${n}`, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [w]);
  for (const token of clubs) assert.ok((await joinClub(store, club(token), userId, [w], { holdings: noHold })).ok);
  return w;
}
const say = async (store: Store, token: string, userId: string, text: string, at: number) => {
  await store.del(`declub:rl:club-post-cd:${token.toLowerCase()}:${userId}`, `declub:rl:club-post-hr:${token.toLowerCase()}:${userId}`);
  const r = await createPost(store, club(token), userId, { kind: "note", text }, { now: () => at });
  assert.ok(r.ok, JSON.stringify(r));
  return r.post.id;
};
const texts = (r: { posts: { text: string | null }[] }) => r.posts.map((p) => p.text);
/** One big page, unless the test asks for less. */
const list = (store: Store, reg: Registry, v: { userId?: string; scope: "joined" | "all" | "others"; before?: { at: number; id: string }; limit?: number }) => listTimeline(store, reg, { limit: 100, ...v });
/** Every page of a list, one after another as the page would ask, and how many pages it took. */
async function all(store: Store, reg: Registry, v: { userId?: string; scope: "joined" | "all" | "others"; limit: number }) {
  const posts: { id: string; text: string | null }[] = [];
  let before: { at: number; id: string } | undefined;
  let pages = 0;
  for (;;) {
    const r = await listTimeline(store, reg, { ...v, before });
    pages++;
    posts.push(...r.posts);
    assert.ok(pages < 200, "the pages end");
    if (r.next === null) return { posts, pages };
    before = parseCursor(r.next)!;
  }
}

/** u1 is in A and C; u2 in B; u3 in A. Posts, oldest first: a1 (A), b1 (B), c1 (C), a2 (A). */
async function world() {
  const store = memoryStore();
  await member(store, "u1", 1, [A, C]);
  await member(store, "u2", 2, [B]);
  await member(store, "u3", 3, [A]);
  const ids = {
    a1: await say(store, A, "u3", "a1", 1_000),
    b1: await say(store, B, "u2", "b1", 2_000),
    c1: await say(store, C, "u1", "c1", 3_000),
    a2: await say(store, A, "u1", "a2", 4_000),
  };
  return { store, ids };
}

describe("listTimeline", () => {
  it("lists a reader's own Clubs under joined, and every other Club under others, newest first", async () => {
    const { store } = await world();
    const joined = await list(store, live, { userId: "u1", scope: "joined" });
    assert.deepEqual(texts(joined), ["a2", "c1", "a1"]);
    assert.deepEqual(joined.posts.map((p) => p.club), [A.toLowerCase(), C.toLowerCase(), A.toLowerCase()]);
    assert.deepEqual(texts(await list(store, live, { userId: "u1", scope: "others" })), ["b1"]);
  });

  it("shows an anonymous reader every Club under others, and nothing under joined", async () => {
    const { store } = await world();
    assert.deepEqual(texts(await list(store, live, { scope: "others" })), ["a2", "c1", "b1", "a1"]);
    assert.deepEqual((await list(store, live, { scope: "joined" })).posts, []);
  });

  it("lists every Club under all, whoever asks", async () => {
    const { store } = await world();
    assert.deepEqual(texts(await list(store, live, { scope: "all" })), ["a2", "c1", "b1", "a1"]);
    assert.deepEqual(texts(await list(store, live, { userId: "u2", scope: "all" })), ["a2", "c1", "b1", "a1"]);
  });

  it("leaves an archived Club out of all, but keeps it for a member", async () => {
    const { store } = await world();
    assert.deepEqual(texts(await list(store, frozen, { scope: "all" })), ["a2", "b1", "a1"]);
    assert.deepEqual(texts(await list(store, frozen, { userId: "u1", scope: "all" })), ["a2", "c1", "b1", "a1"]);
  });

  it("leaves an archived Club out of others, but keeps it for a member", async () => {
    const { store } = await world();
    assert.deepEqual(texts(await list(store, frozen, { scope: "others" })), ["a2", "b1", "a1"]);
    assert.deepEqual(texts(await list(store, frozen, { userId: "u1", scope: "joined" })), ["a2", "c1", "a1"]);
  });

  it("never lists hidden posts or replies, even to their author or a moderator", async () => {
    const { store, ids } = await world();
    await saveRoles(store, A.toLowerCase(), { owner: "u3", moderators: [] });
    assert.deepEqual(await hidePost(store, club(A), { userId: "u3", wallet: wallet(3) }, ids.a2, true), { ok: true });
    await store.del(`declub:rl:club-reply-cd:${A.toLowerCase()}:u3`);
    const reply = await createReply(store, club(A), "u3", ids.a1, { text: "a reply" }, { now: () => 5_000 });
    assert.ok(reply.ok, JSON.stringify(reply));
    for (const userId of ["u1", "u3", undefined]) {
      const all = [...(await list(store, live, { userId, scope: "joined" })).posts, ...(await list(store, live, { userId, scope: "others" })).posts];
      assert.ok(!all.some((p) => p.text === "a2" || p.text === "a reply"), `${userId}`);
    }
  });

  it("counts likes and replies, and says which posts the reader liked", async () => {
    const { store, ids } = await world();
    assert.deepEqual(await likePost(store, club(A), "u1", ids.a1, true), { ok: true, likes: 1 });
    await store.del(`declub:rl:club-reply-cd:${A.toLowerCase()}:u1`);
    assert.ok((await createReply(store, club(A), "u1", ids.a1, { text: "hi" }, { now: () => 5_000 })).ok);
    const mine = (await list(store, live, { userId: "u1", scope: "joined" })).posts;
    const a1 = mine.find((p) => p.id === ids.a1)!;
    assert.equal(a1.likes, 1);
    assert.equal(a1.replies, 1);
    assert.equal(a1.liked, true);
    assert.equal(mine.find((p) => p.id === ids.c1)!.liked, false);
    // Someone else sees the count, not the reader's like.
    const other = (await list(store, live, { userId: "u3", scope: "joined" })).posts.find((p) => p.id === ids.a1)!;
    assert.equal(other.likes, 1);
    assert.equal(other.liked, false);
    assert.equal(other.mine, true);
  });

  it("pages the merged list by cursor: each page starts after the last, and none repeats", async () => {
    const { store } = await world();
    const first = await listTimeline(store, live, { scope: "others", limit: 3 });
    assert.deepEqual(texts(first), ["a2", "c1", "b1"]);
    assert.ok(first.next);
    const rest = await listTimeline(store, live, { scope: "others", limit: 3, before: parseCursor(first.next)! });
    assert.deepEqual(texts(rest), ["a1"]);
    assert.equal(rest.next, null);
  });

  it("has no cap: it pages through every post a Club keeps, in order, none twice", async () => {
    const store = memoryStore();
    await member(store, "u2", 2, [B]);
    await member(store, "u3", 3, [A]);
    const expected: string[] = [];
    // Two Clubs interleaved, far more than a page, and several posts in the same moment.
    for (let i = 0; i < 90; i++) {
      const token = i % 3 === 0 ? A : B;
      await say(store, token, token === A ? "u3" : "u2", `p${i}`, 1_000 + Math.floor(i / 2));
      expected.push(`p${i}`);
    }
    const r = await all(store, live, { scope: "others", limit: 20 });
    assert.equal(r.posts.length, 90);
    assert.equal(new Set(r.posts.map((p) => p.id)).size, 90);
    assert.ok(r.pages >= 5);
    // Newest first, and the same list whatever the page size.
    const sizes = await Promise.all([7, 20, 50].map((limit) => all(store, live, { scope: "others", limit })));
    for (const s of sizes) assert.deepEqual(s.posts.map((p) => p.id), r.posts.map((p) => p.id));
    const one = (await list(store, live, { scope: "others", limit: 100 })).posts.map((p) => p.id);
    assert.deepEqual(r.posts.map((p) => p.id), one);
  });

  it("goes on past posts that are hidden or gone, even a page's worth of them", async () => {
    const store = memoryStore();
    await member(store, "u2", 2, [B]);
    await member(store, "own", 5, [B]);
    await saveRoles(store, B.toLowerCase(), { owner: "own", moderators: [] });
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) ids.push(await say(store, B, "u2", `p${i}`, 1_000 + i));
    // The newest 25 are hidden by the Owner and one in the middle was deleted: the list skips them without ending early.
    for (const id of ids.slice(35)) assert.deepEqual(await hidePost(store, club(B), { userId: "own", wallet: wallet(5) }, id, true), { ok: true });
    await store.del(postKey(B, ids[10]!));
    const r = await all(store, live, { scope: "others", limit: 5 });
    assert.deepEqual(r.posts.map((p) => p.text), Array.from({ length: 35 }, (_, i) => `p${34 - i}`).filter((t) => t !== "p10"));
  });

  it("never carries a user id", async () => {
    const { store } = await world();
    assert.ok(!JSON.stringify(await list(store, live, { userId: "u1", scope: "joined" })).includes("u1"));
  });
});

describe("GET /api/timeline", () => {
  const store = getStore()!;
  const get = (query: string, headers: Record<string, string> = {}) =>
    timelineHandler(live, { viewer: async (r) => (r.headers.get("authorization") ? { id: "u1" } : null) })(
      new Request(`http://x/api/timeline${query}`, { headers: { "x-forwarded-for": "203.0.113.7", ...headers } }),
    );

  it("rejects an unknown scope and a bad page", async () => {
    assert.equal((await get("?scope=everyone")).status, 400);
    assert.equal((await get("?limit=0")).status, 400);
    assert.equal((await get("?limit=1000")).status, 400);
    assert.equal((await get("?before=nonsense")).status, 400);
  });

  it("answers all (the default) publicly and cached, and joined as the reader's own", async () => {
    await member(store, "u1", 1, [A]);
    await member(store, "u2", 2, [B]);
    await say(store, A, "u1", "mine", 1_000);
    await say(store, B, "u2", "theirs", 2_000);

    const anon = await get("");
    assert.equal(anon.status, 200);
    assert.match(anon.headers.get("cache-control")!, /s-maxage/);
    assert.deepEqual(texts(await anon.json()), ["theirs", "mine"]);

    assert.deepEqual(texts(await (await get("?scope=all", { authorization: "Bearer t" })).json()), ["theirs", "mine"]);
    const signedIn = await get("?scope=others", { authorization: "Bearer t" });
    assert.equal(signedIn.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(texts(await signedIn.json()), ["theirs"]);
    assert.deepEqual(texts(await (await get("?scope=joined", { authorization: "Bearer t" })).json()), ["mine"]);
    // Without a token there is no "yours".
    assert.deepEqual(texts(await (await get("?scope=joined")).json()), []);
  });
});

describe("toColumns", () => {
  const h = (n: number) => n;
  it("puts each item under the shortest column, leftmost on a tie", () => {
    // 300 → col 0; 100 → col 1; 100 → col 2; then col 1 and 2 are shortest (100 each), col 1 first.
    assert.deepEqual(toColumns([300, 100, 100, 100, 100, 100], 3, h), [[300], [100, 100, 100], [100, 100]]);
  });

  it("keeps what is placed when more arrives, so loading more never moves a card", () => {
    const first = [260, 140, 200, 120, 180, 220, 100];
    const more = [...first, 150, 90, 240];
    const a = toColumns(first, 3, h);
    const b = toColumns(more, 3, h);
    a.forEach((column, i) => assert.deepEqual(b[i]!.slice(0, column.length), column));
  });

  it("is one column on a phone, and never fewer than one", () => {
    assert.deepEqual(toColumns([1, 2, 3], 1, h), [[1, 2, 3]]);
    assert.deepEqual(toColumns([1, 2], 0, h), [[1, 2]]);
    assert.deepEqual(toColumns([], 3, h), [[], [], []]);
  });

  it("estimates a card taller for more text and for what is attached", () => {
    const plain = { text: "hi", link: undefined, x: undefined };
    assert.ok(estimateHeight({ ...plain, text: "x".repeat(200) }) > estimateHeight(plain));
    assert.ok(estimateHeight({ ...plain, link: { kind: "deal", id: "1" } }) > estimateHeight(plain));
    assert.ok(estimateHeight({ ...plain, link: { kind: "x", id: "1" }, x: { id: "1", author: "a", text: "t", image: "https://pbs.twimg.com/x.jpg", own: false, counted: null } as never }) > estimateHeight({ ...plain, link: { kind: "deal", id: "1" } }));
  });
});

describe("a wallet's Board posts (ADR 0042)", () => {
  /** u1 (in A and C) wrote a1, c1, a2; u2 (in B) wrote b1. */
  async function wallets() {
    const store = memoryStore();
    const w1 = await member(store, "u1", 1, [A, C]);
    const w2 = await member(store, "u2", 2, [B]);
    const a1 = await say(store, A, "u1", "a1", 1_000);
    await say(store, B, "u2", "b1", 2_000);
    const c1 = await say(store, C, "u1", "c1", 3_000);
    const a2 = await say(store, A, "u1", "a2", 4_000);
    return { store, w1, w2, ids: { a1, c1, a2 } };
  }

  it("lists only that wallet's posts, newest first, across Clubs", async () => {
    const { store, w1, w2 } = await wallets();
    assert.deepEqual(texts(await listWalletPosts(store, live, w1, { limit: 20 })), ["a2", "c1", "a1"]);
    assert.deepEqual(texts(await listWalletPosts(store, live, w2, { limit: 20 })), ["b1"]);
    assert.deepEqual((await listWalletPosts(store, live, wallet(99), { limit: 20 })).posts, []);
  });

  it("names each post's Club, and shows the reader's likes", async () => {
    const { store, w1, ids } = await wallets();
    await member(store, "u3", 3, [A]);
    assert.ok((await likePost(store, club(A), "u3", ids.a2, true)).ok);
    const anon = await listWalletPosts(store, live, w1, { limit: 20 });
    assert.deepEqual(anon.posts.map((p) => p.club), [A, C, A].map((t) => t.toLowerCase()));
    assert.equal(anon.posts[0]!.likes, 1);
    assert.equal(anon.posts[0]!.liked, false);
    assert.equal((await listWalletPosts(store, live, w1, { limit: 20, userId: "u3" })).posts[0]!.liked, true);
  });

  it("leaves out hidden posts and replies, and posts in Clubs that left the list", async () => {
    const { store, w1, ids } = await wallets();
    await member(store, "u3", 3, [A]);
    await saveRoles(store, A.toLowerCase(), { owner: "u3", moderators: [] });
    assert.ok((await hidePost(store, club(A), { userId: "u3", wallet: wallet(3) }, ids.a2, true)).ok);
    assert.ok((await createReply(store, club(A), "u1", ids.a1, { text: "re" }, { now: () => 5_000 })).ok);
    assert.deepEqual(texts(await listWalletPosts(store, live, w1, { limit: 20 })), ["c1", "a1"]);
    const noC = makeRegistry(parseAssets(entries(false).filter((e) => e.address.toLowerCase() !== C.toLowerCase())));
    assert.deepEqual(texts(await listWalletPosts(store, noC, w1, { limit: 20 })), ["a1"]);
  });

  it("pages with the timeline's cursor, each post once, to the end", async () => {
    const { store, w1 } = await wallets();
    const seen: (string | null)[] = [];
    let before: { at: number; id: string } | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const r = await listWalletPosts(store, live, w1, { limit: 1, before });
      seen.push(...texts(r));
      if (r.next === null) break;
      before = parseCursor(r.next)!;
    }
    assert.deepEqual(seen, ["a2", "c1", "a1"]);
  });

  it("is served by the route, and refuses what isn't an address or a page", async () => {
    const { store, w1 } = await wallets();
    const get = walletBoardHandler(live, { store: () => store });
    const ctx = (address: string) => ({ params: Promise.resolve({ address }) });
    const res = await get(new Request("http://x?limit=2"), ctx(w1));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage/);
    const body = (await res.json()) as { enabled: boolean; posts: { text: string }[]; next: string | null };
    assert.deepEqual(body.posts.map((p) => p.text), ["a2", "c1"]);
    assert.ok(body.next);
    assert.equal((await get(new Request("http://x"), ctx("nope"))).status, 400);
    assert.equal((await get(new Request("http://x?limit=0"), ctx(w1))).status, 400);
    assert.equal((await get(new Request("http://x?before=junk"), ctx(w1))).status, 400);
    const off = await walletBoardHandler(live, { store: () => null })(new Request("http://x"), ctx(w1));
    assert.deepEqual(await off.json(), { enabled: false, posts: [], next: null });
  });
});
