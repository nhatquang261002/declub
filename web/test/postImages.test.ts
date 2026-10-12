import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POSTS_KEPT, POST_IMAGES_PER_DAY, POST_IMAGE_MAX_BYTES, viewPost, type StoredPost } from "../lib/clubPosts";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { createSignedPost, deletePost, exportPosts, hidePost, listPosts, postKey, postsKey, purgeClub, readPostImage, type Deps } from "../lib/server/board";
import { saveRoles } from "../lib/server/clubState";
import { joinClub } from "../lib/server/members";
import { imageHash, memoryImageStore, parsePostImage, postImageKey, type PostPicture } from "../lib/server/postImages";
import { memoryStore, type Store } from "../lib/server/store";
import { SOCIAL_TYPES, draftPost, parsePostMessage, postId, postTypedData, type PostMessage } from "../lib/social";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const reg = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." }]));
const club = reg.clubFor(NFT)!;
const alice = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const bob = privateKeyToAccount(`0x${"b2".repeat(32)}`);
const mod = privateKeyToAccount(`0x${"c3".repeat(32)}`);
const NOW_SEC = 1_800_000_000;

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff];
/** A picture that passes the byte check, different for each `seed`. */
const bytesOf = (head: number[], seed = 0, size = 16) => Buffer.concat([Buffer.from(head), Buffer.alloc(size, seed + 1)]);
const urlOf = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;
const picture = (seed = 0): PostPicture => {
  const parsed = parsePostImage(urlOf("image/png", bytesOf(PNG_HEAD, seed)));
  assert.ok(parsed);
  return parsed;
};

let clock = NOW_SEC * 1000;
let images: ReturnType<typeof memoryImageStore>;
let deps: Deps;
let store: Store;

async function member(userId: string, wallet: string, holder = false) {
  await store.set(profileKey(wallet.toLowerCase()), { provider: "twitter", handle: userId, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [wallet.toLowerCase()]);
  assert.ok((await joinClub(store, club, userId, [wallet.toLowerCase()], { holdings: async () => [holder ? 1n : 0n] })).ok);
}
const clear = (userId: string) => store.del(`declub:rl:club-post-cd:${NFT.toLowerCase()}:${userId}`, `declub:rl:club-post-hr:${NFT.toLowerCase()}:${userId}`);

/** A post by Alice with `pic`, signed over its hash. */
async function post(text: string, pic: PostPicture | null | undefined, over: Partial<PostMessage> = {}, at = NOW_SEC) {
  const draft = draftPost(NFT, "note", text, "", at, pic ? pic.hash : undefined);
  assert.ok(draft.ok);
  const message = { ...draft.message, ...over };
  // Each post is stamped with the clock, so the Board has an oldest one.
  clock = at * 1000;
  await clear("ua");
  return createSignedPost(store, club, "ua", { message, signature: await alice.signTypedData(postTypedData(message)), picture: pic }, deps);
}

beforeEach(async () => {
  store = memoryStore();
  images = memoryImageStore();
  deps = {
    now: () => clock,
    images,
    admins: new Set(),
    verifyPost: async (signer, message, signature) => verifyTypedData({ address: signer, signature, ...postTypedData(message) }),
  };
  await member("ua", alice.address, true);
  await member("ub", bob.address);
  await member("umod", mod.address);
  await saveRoles(store, NFT.toLowerCase(), { owner: "ub", moderators: ["umod"] });
});

describe("the ImagePost type", () => {
  it("adds the picture's hash as a bytes32 and leaves Post as it was", () => {
    assert.equal(SOCIAL_TYPES.Post.map((f) => `${f.type} ${f.name}`).join(","), "address club,string kind,string text,string link,uint64 at");
    assert.equal(
      SOCIAL_TYPES.ImagePost.map((f) => `${f.type} ${f.name}`).join(","),
      "address club,string kind,string text,string link,bytes32 image,uint64 at",
    );
  });

  it("gives a post with a picture another id than the same post without, and another for another picture", () => {
    const plain = draftPost(NFT, "note", "gm", "", NOW_SEC);
    const one = draftPost(NFT, "note", "gm", "", NOW_SEC, picture(0).hash);
    const two = draftPost(NFT, "note", "gm", "", NOW_SEC, picture(1).hash);
    assert.ok(plain.ok && one.ok && two.ok);
    assert.equal(postTypedData(plain.message).primaryType, "Post");
    assert.equal(postTypedData(one.message).primaryType, "ImagePost");
    assert.equal(new Set([postId(plain.message), postId(one.message), postId(two.message)]).size, 3);
  });

  it("reads an image hash from a request, and refuses anything that isn't a SHA-256", () => {
    const good = { club: NFT, kind: "note", text: "x", link: "", at: 1, image: picture().hash };
    assert.equal(parsePostMessage(good)?.image, picture().hash);
    for (const image of ["0x12", picture().hash.toUpperCase().replace("0X", "0x"), 5, null]) assert.equal(parsePostMessage({ ...good, image }), null);
    assert.equal(parsePostMessage({ ...good, image: undefined })?.image, undefined);
  });
});

describe("parsePostImage", () => {
  it("takes a PNG, JPEG or WebP whose bytes are what it says, and hashes them", () => {
    const png = bytesOf(PNG_HEAD);
    const parsed = parsePostImage(urlOf("image/png", png));
    assert.equal(parsed?.type, "image/png");
    assert.equal(parsed?.hash, imageHash(png));
    assert.equal(parsePostImage(urlOf("image/jpeg", bytesOf(JPEG_HEAD)))?.type, "image/jpeg");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
    assert.equal(parsePostImage(urlOf("image/webp", webp))?.type, "image/webp");
  });

  it("refuses SVG, GIF, other types, wrong bytes, empty and oversize pictures", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal(parsePostImage(urlOf("image/svg+xml", svg)), null);
    assert.equal(parsePostImage(urlOf("image/gif", Buffer.from("GIF89a....."))), null);
    assert.equal(parsePostImage(urlOf("text/html", Buffer.from("<html>"))), null);
    assert.equal(parsePostImage(urlOf("image/png", bytesOf(JPEG_HEAD))), null, "a JPEG sent as a PNG");
    assert.equal(parsePostImage("data:image/png;base64,"), null);
    assert.equal(parsePostImage(urlOf("image/png", bytesOf(PNG_HEAD, 0, POST_IMAGE_MAX_BYTES))), null);
    assert.equal(parsePostImage("data:image/png;base64,%%%"), null);
    assert.equal(parsePostImage("https://example.com/a.png"), null);
    assert.equal(parsePostImage(42), null);
  });
});

describe("a post with a picture", () => {
  it("keeps the picture in object storage under the post's id, and says so in the post", async () => {
    const pic = picture();
    const r = await post("look at this", pic);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(images.keys(), [postImageKey(NFT, r.post.id)]);
    assert.deepEqual(r.post.image, { url: `/api/clubs/${NFT.toLowerCase()}/posts/${r.post.id}/image`, type: "image/png" });
    const stored = (await store.get<StoredPost>(postKey(NFT, r.post.id)))!;
    assert.deepEqual(stored.image, { type: "image/png", size: pic.bytes.length, hash: pic.hash });
  });

  it("refuses a picture that isn't the one signed, or that is missing or unwanted", async () => {
    assert.deepEqual(await post("a", picture(1), { image: picture(2).hash }), { ok: false, reason: "not_clean" }, "another picture's hash");
    const draft = draftPost(NFT, "note", "b", "", NOW_SEC, picture().hash);
    assert.ok(draft.ok);
    const signature = await alice.signTypedData(postTypedData(draft.message));
    assert.deepEqual(
      await createSignedPost(store, club, "ua", { message: draft.message, signature }, deps),
      { ok: false, reason: "bad_image" },
      "the signed picture wasn't sent",
    );
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: draft.message, signature, picture: null }, deps), { ok: false, reason: "bad_image" });
    const bare = draftPost(NFT, "note", "c", "", NOW_SEC);
    assert.ok(bare.ok);
    const bareSignature = await alice.signTypedData(postTypedData(bare.message));
    assert.deepEqual(
      await createSignedPost(store, club, "ua", { message: bare.message, signature: bareSignature, picture: picture() }, deps),
      { ok: false, reason: "not_clean" },
      "a picture the message doesn't sign",
    );
    assert.deepEqual(images.keys(), []);
  });

  it("is refused where there is no picture store, and a text post still goes through", async () => {
    deps = { ...deps, images: null };
    assert.deepEqual(await post("a", picture()), { ok: false, reason: "images_unavailable" });
    assert.ok((await post("b", undefined, {}, NOW_SEC + 1)).ok);
  });

  it("is refused, and not posted, when the store fails", async () => {
    deps = { ...deps, images: { ...images, put: async () => Promise.reject(new Error("down")) } };
    assert.deepEqual(await post("a", picture()), { ok: false, reason: "images_unavailable" });
    assert.deepEqual(await exportPosts(store, club), []);
  });

  it("limits pictures a day apart from posts", async () => {
    for (let i = 0; i < POST_IMAGES_PER_DAY; i++) assert.ok((await post(`p${i}`, picture(i), {}, NOW_SEC + i)).ok, `picture ${i}`);
    assert.deepEqual(await post("one more", picture(99), {}, NOW_SEC + 99), { ok: false, reason: "image_limit" });
    assert.equal(images.keys().length, POST_IMAGES_PER_DAY, "the refused one was not stored");
    assert.ok((await post("text is fine", undefined, {}, NOW_SEC + 100)).ok);
  });

  it("is not stored twice when the same signed post is sent twice", async () => {
    const pic = picture();
    const first = await post("once", pic);
    const again = await post("once", pic);
    assert.ok(first.ok && again.ok);
    assert.equal(again.post.id, first.post.id);
    assert.equal(images.keys().length, 1);
  });

  it("is exported with its hash in the signed message, so a copy can be checked", async () => {
    const pic = picture();
    const r = await post("portable", pic);
    assert.ok(r.ok);
    const [exported] = await exportPosts(store, club);
    assert.equal(exported!.message.image, pic.hash);
    assert.equal(exported!.image?.url, r.post.image!.url);
    assert.ok(await verifyTypedData({ address: exported!.signer, signature: exported!.signature, ...postTypedData(exported!.message) }));
    assert.equal(postId(exported!.message), exported!.id);
    assert.equal(imageHash((await images.get(postImageKey(NFT, exported!.id)))!.bytes), exported!.message.image);
  });
});

describe("serving a picture", () => {
  const author = { userId: "ua" };
  let id: string;
  beforeEach(async () => {
    const r = await post("pic", picture());
    assert.ok(r.ok);
    id = r.post.id;
  });

  it("gives it to anyone while the post is shown", async () => {
    for (const viewer of [{}, { userId: "ub" }, author]) {
      const r = await readPostImage(store, club, id, viewer, deps);
      assert.ok(r.ok);
      assert.equal(r.type, "image/png");
      assert.equal(r.hidden, false);
    }
  });

  it("goes with the text when a moderator hides the post: only its author and staff get it", async () => {
    const hidden = await hidePost(store, club, { userId: "umod", wallet: mod.address.toLowerCase() }, id, true, deps);
    assert.ok(hidden.ok, JSON.stringify(hidden));
    assert.deepEqual(await readPostImage(store, club, id, {}, deps), { ok: false, reason: "not_found" });
    assert.deepEqual(await readPostImage(store, club, id, { userId: "stranger" }, deps), { ok: false, reason: "not_found" });
    for (const viewer of [author, { userId: "umod" }, { userId: "ub" }]) {
      const r = await readPostImage(store, club, id, viewer, deps);
      assert.ok(r.ok, JSON.stringify(viewer));
      assert.equal(r.hidden, true);
    }
    // The Board's view of it drops the picture for everyone else, as it drops the text.
    const stored = (await store.get<StoredPost>(postKey(NFT, id)))!;
    assert.equal(viewPost(NFT, stored, { userId: "stranger", staff: false }, false).image, undefined);
    assert.ok(viewPost(NFT, stored, { userId: "ua", staff: false }, false).image);
    const board = await listPosts(store, club, {}, deps);
    assert.equal(board.posts[0]!.image, undefined);
  });

  it("is not found for a post without one, or an unknown post, and says so when the store is down", async () => {
    const plain = await post("plain", undefined, {}, NOW_SEC + 1);
    assert.ok(plain.ok);
    assert.deepEqual(await readPostImage(store, club, plain.post.id, {}, deps), { ok: false, reason: "not_found" });
    assert.deepEqual(await readPostImage(store, club, "f".repeat(64), {}, deps), { ok: false, reason: "not_found" });
    assert.deepEqual(await readPostImage(store, club, id, {}, { ...deps, images: null }), { ok: false, reason: "images_unavailable" });
    assert.deepEqual(await readPostImage(store, club, id, {}, { ...deps, images: { ...images, get: async () => Promise.reject(new Error("down")) } }), {
      ok: false,
      reason: "images_unavailable",
    });
  });
});

describe("a picture's lifetime", () => {
  it("ends with its post", async () => {
    const r = await post("bye", picture());
    assert.ok(r.ok);
    assert.equal(images.keys().length, 1);
    assert.deepEqual(await deletePost(store, club, { userId: "ua", wallet: alice.address }, r.post.id, deps), { ok: true });
    assert.deepEqual(images.keys(), []);
  });

  it("ends when the Club is purged", async () => {
    assert.ok((await post("one", picture(0))).ok);
    assert.ok((await post("two", picture(1), {}, NOW_SEC + 1)).ok);
    assert.equal(images.keys().length, 2);
    await purgeClub(store, NFT, deps);
    assert.deepEqual(images.keys(), []);
  });

  it("ends when the post falls off a full Board, and not before", async () => {
    const old = await post("oldest", picture(0));
    assert.ok(old.ok);
    // The Board holds POSTS_KEPT posts: fill the rest of it with newer ones.
    await store.rank(
      postsKey(NFT),
      Array.from({ length: POSTS_KEPT - 2 }, (_, i) => ({ member: `${i}`.padStart(32, "0"), score: NOW_SEC * 1000 + 10 + i })),
      POSTS_KEPT,
    );
    const next = await post("one more", picture(1), {}, NOW_SEC + 1);
    assert.ok(next.ok);
    assert.equal(images.keys().length, 2, "the Board is full but nothing has fallen off yet");
    const last = await post("pushes one off", undefined, {}, NOW_SEC + 2);
    assert.ok(last.ok);
    assert.deepEqual(images.keys(), [postImageKey(NFT, next.post.id)], "the oldest post's picture went with it");
  });
});

describe("what the post's wallet signs", () => {
  it("covers the picture: a signature over another hash is refused", async () => {
    const draft = draftPost(NFT, "note", "swap", "", NOW_SEC, picture(1).hash);
    assert.ok(draft.ok);
    const signedForOther = await alice.signTypedData(postTypedData({ ...draft.message, image: picture(2).hash as Hex }));
    await clear("ua");
    assert.deepEqual(await createSignedPost(store, club, "ua", { message: draft.message, signature: signedForOther, picture: picture(1) }, deps), {
      ok: false,
      reason: "bad_signature",
    });
    assert.deepEqual(images.keys(), []);
  });
});
