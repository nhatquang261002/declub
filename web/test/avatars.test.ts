import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, type Address } from "viem";
import { avatarImageKey, avatarKey, avatarWalletsKey, type StoredAvatar, type StoredImage } from "../lib/avatars";
import {
  clearAvatar,
  keptImage,
  ownedAvatar,
  parseImage,
  readAvatars,
  setNftAvatar,
  setUploadAvatar,
  stillHeld,
  syncAvatar,
  type AvatarChain,
  type AvatarDeps,
} from "../lib/server/avatars";
import { handlePrivyEvent } from "../lib/server/privyWebhook";
import { memoryStore } from "../lib/server/store";

const NFT = getAddress("0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4");
const W1 = getAddress("0x00000000000000000000000000000000000000a1");
const W2 = getAddress("0x00000000000000000000000000000000000000b2");
const OTHER = getAddress("0x00000000000000000000000000000000000000c3");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngUrl = `data:image/png;base64,${PNG.toString("base64")}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

/** A chain that answers `ownerOf` and `tokenURI` from tables keyed by token id. */
function fakeChain(owners: Record<string, Address | null>, uris: Record<string, string> = {}) {
  const chain: AvatarChain & { down: boolean } = {
    down: false,
    async owners(tokens) {
      if (chain.down) throw new Error("rpc down");
      return tokens.map((t) => owners[t.tokenId.toString()] ?? null);
    },
    async tokenURI(_collection, tokenId) {
      return uris[tokenId.toString()] ?? null;
    },
  };
  return chain;
}
const meta = (json: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`;

describe("parseImage", () => {
  it("keeps a PNG whose bytes are a PNG", () => {
    assert.deepEqual(parseImage(pngUrl, false), { type: "image/png", data: PNG.toString("base64") });
  });

  it("refuses bytes that aren't what the type says", () => {
    const fake = `data:image/png;base64,${Buffer.from("<html><script>alert(1)</script>").toString("base64")}`;
    assert.equal(parseImage(fake, false), null);
    assert.equal(parseImage("data:text/html;base64,PGh0bWw+", false), null);
  });

  it("allows SVG only for NFT art, written plain or in base64", () => {
    assert.equal(parseImage(`data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`, false), null);
    assert.equal(parseImage(`data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`, true)?.type, "image/svg+xml");
    assert.equal(parseImage(`data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`, true)?.type, "image/svg+xml");
    assert.equal(parseImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`, true)?.type, "image/svg+xml");
  });

  it("refuses a picture past the size cap", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(100_000)]);
    assert.equal(parseImage(`data:image/png;base64,${big.toString("base64")}`, false), null);
  });
});

describe("an NFT avatar", () => {
  const uris = {
    "1": meta({ name: "One", image: "ipfs://bafy/1.png" }),
    "2": meta({ image: `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}` }),
    "3": meta({ image: "javascript:alert(1)" }),
    "4": meta({ image: "http://insecure.example/4.png" }),
  };

  it("is set only when one of the user's wallets owns the token", async () => {
    const store = memoryStore();
    const deps: AvatarDeps = { chain: fakeChain({ "1": OTHER }, uris) };
    assert.deepEqual(await setNftAvatar(store, "u1", [W1, W2], NFT, 1n, deps), { ok: false, reason: "not_held" });
    assert.deepEqual(await setNftAvatar(store, "u1", [], NFT, 1n, deps), { ok: false, reason: "no_wallet" });
    assert.equal(await store.get(avatarKey(W1)), null);
  });

  it("links to the token's art and goes on every linked wallet", async () => {
    const store = memoryStore();
    const deps: AvatarDeps = { chain: fakeChain({ "1": W2 }, uris) };
    const result = await setNftAvatar(store, "u1", [W1, W2], NFT, 1n, deps);
    assert.deepEqual(result, { ok: true, avatar: { image: "https://ipfs.io/ipfs/bafy/1.png", nft: { collection: NFT, tokenId: "1" } } });
    const seen = await readAvatars(store, [W1.toLowerCase(), W2.toLowerCase(), OTHER.toLowerCase()], deps);
    assert.deepEqual(Object.keys(seen), [W1.toLowerCase(), W2.toLowerCase()]);
    assert.equal((await store.get<StoredAvatar>(avatarKey(W1)))?.nft?.holder, W2.toLowerCase());
  });

  it("keeps inline art here and serves it from this app", async () => {
    const store = memoryStore();
    const deps: AvatarDeps = { chain: fakeChain({ "2": W1 }, uris) };
    const result = await setNftAvatar(store, "u1", [W1], NFT, 2n, deps);
    assert.ok(result.ok);
    assert.match(result.avatar.image, new RegExp(`^/api/avatars/${W1.toLowerCase()}\\?v=\\d+$`));
    assert.equal((await keptImage(store, W1))?.type, "image/svg+xml");
  });

  it("refuses art that isn't a plain https or inline image", async () => {
    const store = memoryStore();
    const deps: AvatarDeps = { chain: fakeChain({ "3": W1, "4": W1, "5": W1 }, uris) };
    for (const id of [3n, 4n, 5n]) {
      assert.deepEqual(await setNftAvatar(store, "u1", [W1], NFT, id, deps), { ok: false, reason: "no_image" });
    }
  });

  it("stops showing once the wallet no longer holds the token, and shows again if it returns", async () => {
    const store = memoryStore();
    const owners: Record<string, Address | null> = { "1": W1 };
    const chain = fakeChain(owners, uris);
    await setNftAvatar(store, "u1", [W1], NFT, 1n, { chain });
    owners["1"] = OTHER;
    assert.deepEqual(await readAvatars(store, [W1.toLowerCase()], { chain }), {});
    assert.equal(await stillHeld((await ownedAvatar(store, "u1", [W1]))!, { chain }), false);
    owners["1"] = W1;
    assert.equal(Object.keys(await readAvatars(store, [W1.toLowerCase()], { chain })).length, 1);
  });

  it("still shows when the chain can't be asked", async () => {
    const store = memoryStore();
    const chain = fakeChain({ "1": W1 }, uris);
    await setNftAvatar(store, "u1", [W1], NFT, 1n, { chain });
    chain.down = true;
    assert.equal(Object.keys(await readAvatars(store, [W1.toLowerCase()], { chain })).length, 1);
    assert.equal(await stillHeld((await ownedAvatar(store, "u1", [W1]))!, { chain }), null);
  });
});

describe("an uploaded avatar", () => {
  it("is kept here and replaces an NFT one", async () => {
    const store = memoryStore();
    const chain = fakeChain({ "1": W1 }, { "1": meta({ image: "https://art.example/1.png" }) });
    await setNftAvatar(store, "u1", [W1], NFT, 1n, { chain });
    const result = await setUploadAvatar(store, "u1", [W1], pngUrl);
    assert.ok(result.ok && !result.avatar.nft);
    assert.equal((await store.get<StoredAvatar>(avatarKey(W1)))?.nft, undefined);
    assert.deepEqual((await keptImage(store, W1))?.data, PNG.toString("base64"));
  });

  it("refuses anything that isn't a raster image", async () => {
    const store = memoryStore();
    const svg = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
    assert.deepEqual(await setUploadAvatar(store, "u1", [W1], svg), { ok: false, reason: "bad_image" });
    assert.deepEqual(await setUploadAvatar(store, "u1", [W1], "not a data url"), { ok: false, reason: "bad_image" });
  });

  it("is removed from every wallet, picture and all", async () => {
    const store = memoryStore();
    await setUploadAvatar(store, "u1", [W1, W2], pngUrl);
    await clearAvatar(store, "u1");
    assert.deepEqual(await store.getMany([avatarKey(W1), avatarKey(W2), avatarImageKey("u1")]), [null, null, null]);
    assert.deepEqual(await store.members(avatarWalletsKey("u1")), []);
  });
});

describe("keeping the avatar in step with linked wallets", () => {
  it("follows a newly linked wallet and leaves an unlinked one", async () => {
    const store = memoryStore();
    await setUploadAvatar(store, "u1", [W1], pngUrl);
    await syncAvatar(store, "u1", [W1, W2]);
    assert.ok(await store.get(avatarKey(W2)));
    await syncAvatar(store, "u1", [W2]);
    assert.equal(await store.get(avatarKey(W1)), null);
    assert.ok(await store.get(avatarKey(W2)));
  });

  it("drops an NFT avatar whose holder was unlinked", async () => {
    const store = memoryStore();
    const chain = fakeChain({ "1": W1 }, { "1": meta({ image: "https://art.example/1.png" }) });
    await setNftAvatar(store, "u1", [W1, W2], NFT, 1n, { chain });
    await syncAvatar(store, "u1", [W2]);
    assert.equal(await ownedAvatar(store, "u1", [W2]), null);
    assert.equal(await store.get(avatarKey(W2)), null);
  });

  it("never removes the row of a wallet that moved to another user", async () => {
    const store = memoryStore();
    await setUploadAvatar(store, "u1", [W1], pngUrl);
    await setUploadAvatar(store, "u2", [W1], pngUrl);
    await syncAvatar(store, "u1", []);
    assert.equal((await store.get<StoredAvatar>(avatarKey(W1)))?.userId, "u2");
  });

  it("runs from the Privy webhook", async () => {
    const store = memoryStore();
    await setUploadAvatar(store, "u1", [W1, W2], pngUrl);
    const accounts = [{ type: "wallet", chain_type: "ethereum", address: W2 }];
    await handlePrivyEvent({ type: "user.unlinked_account", user: { id: "u1" } }, store, async () => accounts);
    assert.equal(await store.get(avatarKey(W1)), null);
    assert.ok(await store.get<StoredImage>(avatarImageKey("u1")));
  });
});
