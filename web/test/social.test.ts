import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { hashTypedData, keccak256, toHex, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LENSES, lensOf, type LensContext } from "../lib/lenses";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { createSignedPost, exportPosts, listPosts, postKey, walletPosts, type Deps } from "../lib/server/board";
import { exportFollows, followingOf, recordFollow, type FollowDeps } from "../lib/server/follows";
import { joinClub } from "../lib/server/members";
import { memoryStore, type Store } from "../lib/server/store";
import { SOCIAL_TYPES, draftPost, followTypedData, postId, postTypedData, socialDomain, type FollowMessage, type PostMessage } from "../lib/social";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const OTHER = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const reg = makeRegistry(parseAssets([
  { chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." },
  { chainId: 10143, address: OTHER, kind: "erc721", name: "O", symbol: "O", status: "verified", note: "Why." },
]));
const club = reg.clubFor(NFT)!;
const other = reg.clubFor(OTHER)!;

const alice = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const bob = privateKeyToAccount(`0x${"b2".repeat(32)}`);
const NOW_SEC = 1_800_000_000;
// Board deps count in ms; follows in seconds.
const deps: Deps = { now: () => NOW_SEC * 1000, verifyPost: async (signer, message, signature) => verifyTypedData({ address: signer, signature, ...postTypedData(message) }) };
const followDeps: FollowDeps = { now: () => NOW_SEC, verifyFollow: async (message, signature) => verifyTypedData({ address: message.follower, signature, ...followTypedData(message) }) };

async function member(store: Store, userId: string, wallet: string, holder = false, entry = club) {
  await store.set(profileKey(wallet.toLowerCase()), { provider: "twitter", handle: userId, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [wallet.toLowerCase()]);
  assert.ok((await joinClub(store, entry, userId, [wallet.toLowerCase()], { holdings: async () => [holder ? 1n : 0n] })).ok);
}

const message = (text: string, over: Partial<PostMessage> = {}): PostMessage => {
  const d = draftPost(NFT, "note", text, "", NOW_SEC);
  assert.ok(d.ok);
  return { ...d.message, ...over };
};
const sign = (account: typeof alice, m: PostMessage) => account.signTypedData(postTypedData(m));
const clear = (store: Store, userId: string, token = NFT) =>
  store.del(`declub:rl:club-post-cd:${token.toLowerCase()}:${userId}`, `declub:rl:club-post-hr:${token.toLowerCase()}:${userId}`);

describe("the typed data", () => {
  it("hashes the Post and Follow types as written", () => {
    const postType = "Post(address club,string kind,string text,string link,uint64 at)";
    const followType = "Follow(address follower,address target,bool following,uint64 at)";
    assert.equal(SOCIAL_TYPES.Post.map((f) => `${f.type} ${f.name}`).join(","), postType.slice(5, -1));
    assert.equal(SOCIAL_TYPES.Follow.map((f) => `${f.type} ${f.name}`).join(","), followType.slice(7, -1));
    assert.notEqual(keccak256(toHex(postType)), keccak256(toHex(followType)));
  });

  it("names no contract, so a post signature is no contract's input", () => {
    assert.deepEqual(Object.keys(socialDomain()), ["name", "version", "chainId"]);
    assert.equal(socialDomain().name, "DeClub Social");
  });

  it("drafts exactly what the server stores: cleaned text, canonical link", () => {
    const d = draftPost(NFT.toLowerCase() as Hex, "looking", "  WTB   a Chog ", "0042", NOW_SEC);
    assert.ok(d.ok);
    assert.deepEqual(d.message, { club: NFT, kind: "looking", text: "WTB a Chog", link: "42", at: NOW_SEC });
    assert.deepEqual(draftPost(NFT, "note", "x", "42", NOW_SEC), { ok: false, reason: "bad_link" });
    assert.deepEqual(draftPost(NFT, "note", "   ", "", NOW_SEC), { ok: false, reason: "empty" });
  });

  it("gives a post's id as its struct hash, the same for the same message", () => {
    const m = message("gm");
    assert.equal(postId(m), postId({ ...m }));
    assert.notEqual(postId(m), postId({ ...m, at: m.at + 1 }));
    assert.match(postId(m), /^[0-9a-f]{64}$/);
    assert.notEqual(hashTypedData(postTypedData(m)), `0x${postId(m)}`, "the id is the struct hash, not the signed digest");
  });
});

describe("signed posts", () => {
  let store: Store;
  beforeEach(async () => {
    store = memoryStore();
    await member(store, "ua", alice.address, true);
    await member(store, "ub", bob.address);
  });

  it("takes a post signed by the member's Club wallet, and keeps the signature", async () => {
    const m = message("gm Chogs");
    const r = await createSignedPost(store, club, "ua", { message: m, signature: await sign(alice, m) }, deps);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.post.id, postId(m));
    assert.equal(r.post.signed, true);
  });

  it("refuses a signature by anyone but the member's Club wallet", async () => {
    const m = message("not mine");
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: m, signature: await sign(bob, m) }, deps), { ok: false, reason: "bad_signature" });
  });

  it("refuses a post signed for another Club, from another time, or not as stored", async () => {
    const elsewhere = message("hi", { club: OTHER as Hex });
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: elsewhere, signature: await sign(alice, elsewhere) }, deps), { ok: false, reason: "wrong_club" });
    const old = message("hi", { at: NOW_SEC - 301 });
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: old, signature: await sign(alice, old) }, deps), { ok: false, reason: "stale" });
    const messy = message("hi", { text: " hi " });
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: messy, signature: await sign(alice, messy) }, deps), { ok: false, reason: "not_clean" });
    const padded = message("hi", { kind: "looking", link: "007" });
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: padded, signature: await sign(alice, padded) }, deps), { ok: false, reason: "not_clean" });
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: message("hi"), signature: undefined }, deps), { ok: false, reason: "unsigned" });
  });

  it("gives back the same post when the same signed post is sent twice", async () => {
    const m = message("once");
    const signature = await sign(alice, m);
    const first = await createSignedPost(store, club, "ua", { message: m, signature }, deps);
    const again = await createSignedPost(store, club, "ua", { message: m, signature }, deps);
    assert.ok(first.ok && again.ok);
    assert.equal(again.post.id, first.post.id);
    assert.equal((await exportPosts(store, club)).length, 1);
  });

  it("exports each signed post so anyone can verify it, per Club and per wallet", async () => {
    const m = message("portable");
    await createSignedPost(store, club, "ua", { message: m, signature: await sign(alice, m) }, deps);
    await member(store, "ua", alice.address, true, other);
    const elsewhere = message("also mine", { club: OTHER as Hex });
    await createSignedPost(store, other, "ua", { message: elsewhere, signature: await sign(alice, elsewhere) }, deps);

    const [exported] = await exportPosts(store, club);
    assert.deepEqual(exported!.message, m);
    assert.equal(exported!.signer, alice.address);
    assert.ok(await verifyTypedData({ address: exported!.signer, signature: exported!.signature, ...postTypedData(exported!.message) }));

    // A post moderation hid leaves the exports, and comes back when restored.
    const key = postKey(NFT, postId(m));
    const stored = (await store.get<Record<string, unknown>>(key))!;
    await store.set(key, { ...stored, hidden: "moderator" });
    assert.deepEqual(await exportPosts(store, club), []);
    assert.deepEqual((await walletPosts(store, alice.address)).map((p) => p.message.text), ["also mine"]);
    await store.set(key, stored);

    const mine = await walletPosts(store, alice.address);
    assert.deepEqual(mine.map((p) => p.message.text).sort(), ["also mine", "portable"]);
    assert.deepEqual(await walletPosts(store, bob.address), []);
  });
});

describe("follows", () => {
  let store: Store;
  beforeEach(() => {
    store = memoryStore();
  });
  const follow = async (following: boolean, at = NOW_SEC, signer = alice, over: Partial<FollowMessage> = {}) => {
    const m: FollowMessage = { follower: alice.address, target: bob.address, following, at, ...over };
    return recordFollow(store, "ua", [alice.address], { message: m, signature: await signer.signTypedData(followTypedData(m)) }, followDeps);
  };

  it("records a signed follow, and a later unfollow undoes it", async () => {
    assert.deepEqual(await follow(true), { ok: true, following: true });
    assert.deepEqual([...(await followingOf(store, alice.address))], [bob.address.toLowerCase()]);
    const exported = await exportFollows(store, alice.address);
    assert.equal(exported.follows.length, 1);
    assert.equal((await exportFollows(store, bob.address)).followers, 1);
    assert.deepEqual(await follow(false, NOW_SEC + 1), { ok: true, following: false });
    assert.equal((await followingOf(store, alice.address)).size, 0);
  });

  it("refuses an older record, someone else's wallet, yourself, a bad signature and a stale one", async () => {
    await follow(true, NOW_SEC);
    assert.deepEqual(await follow(false, NOW_SEC - 1), { ok: false, reason: "outdated" });
    assert.deepEqual(await follow(true, NOW_SEC + 5, alice, { follower: bob.address }), { ok: false, reason: "not_yours" });
    assert.deepEqual(await follow(true, NOW_SEC + 5, alice, { target: alice.address }), { ok: false, reason: "self" });
    assert.deepEqual(await follow(true, NOW_SEC + 5, bob), { ok: false, reason: "bad_signature" });
    assert.deepEqual(await follow(true, NOW_SEC + 400), { ok: false, reason: "stale" });
  });
});

describe("lenses", () => {
  const posts = [
    { id: "a", wallet: "0xaa", kind: "note" as const, at: 3_000 },
    { id: "b", wallet: "0xbb", kind: "note" as const, at: 2_000 },
    { id: "c", wallet: "0xcc", kind: "note" as const, at: 1_000 },
  ];
  const ctx: LensContext = { now: 3_000, follows: new Set(["0xcc"]), holders: new Set(["0xbb", "0xcc"]), momentum: new Map([["0xcc", 50]]) };
  const order = (id: string) => lensOf(id).rank(posts, ctx).map((p) => p.id);

  it("orders and filters by the reader's choice", () => {
    assert.deepEqual(order("newest"), ["a", "b", "c"]);
    assert.deepEqual(order("momentum"), ["c", "a", "b"], "a busy trader's post rises over newer ones");
    assert.deepEqual(order("holders"), ["b", "c"]);
    assert.deepEqual(order("following"), ["c"]);
    assert.equal(lensOf("nonsense").id, "newest");
    assert.deepEqual(LENSES.map((l) => l.id), ["newest", "momentum", "holders", "following"]);
  });

  it("applies to the Board: holders only, and the reader's follows", async () => {
    const store = memoryStore();
    await member(store, "ua", alice.address, true);
    await member(store, "ub", bob.address, false);
    for (const [userId, account, text] of [["ua", alice, "from a Holder"], ["ub", bob, "from Bob"]] as const) {
      await clear(store, userId);
      const m = message(text);
      assert.ok((await createSignedPost(store, club, userId, { message: m, signature: await sign(account, m) }, deps)).ok);
    }
    const read = async (lens: "newest" | "holders" | "following", as?: string) =>
      (await listPosts(store, club, { lens, as }, deps)).posts.map((p) => p.text);
    assert.equal((await read("newest")).length, 2);
    assert.deepEqual(await read("holders"), ["from a Holder"]);
    assert.deepEqual(await read("following", alice.address), []);
    const m: FollowMessage = { follower: alice.address, target: bob.address, following: true, at: NOW_SEC };
    await recordFollow(store, "ua", [alice.address], { message: m, signature: await alice.signTypedData(followTypedData(m)) }, followDeps);
    assert.deepEqual(await read("following", alice.address), ["from Bob"]);
  });
});
