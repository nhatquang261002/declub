import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULT_STICKERS,
  DEFAULT_STICKER_NAMES,
  PACK_EMOJI_MAX,
  PACK_IMAGE_MAX_BYTES,
  PACK_NAME,
  PACK_STICKER_MAX,
  mentionsPack,
  packImageUrl,
  splitShortcodes,
  withDefaults,
  type PackItem,
} from "../lib/clubPack";
import { purgeClub } from "../lib/server/board";
import { addToPack, loadPack, packItems, purgePack, readPackImage, removeFromPack, type PackDeps } from "../lib/server/clubPack";
import { readLog, saveRoles } from "../lib/server/clubState";
import { memoryImageStore, parsePostImage, type PostPicture } from "../lib/server/postImages";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const OLD = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const reg = makeRegistry(
  parseAssets([
    { chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." },
    { chainId: 10143, address: OLD, kind: "erc721", name: "O", symbol: "O", status: "verified", note: "Why.", club: "archived" },
  ]),
);
const club = reg.clubFor(NFT)!;
const archived = reg.clubFor(OLD)!;
const token = NFT.toLowerCase();
const owner = { userId: "own", wallet: "0xaaaa000000000000000000000000000000000001" };
const mod = { userId: "mod", wallet: "0xaaaa000000000000000000000000000000000002" };
const member = { userId: "m1", wallet: "0xaaaa000000000000000000000000000000000003" };
const admin = { userId: "adm", wallet: "0xaaaa000000000000000000000000000000000004" };

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A picture that passes the byte check, different for each `seed`, held to the pack's size. */
const pic = (seed = 0, size = 16): PostPicture => {
  const bytes = Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(size, (seed % 250) + 1), Buffer.from([seed >> 8, seed & 255])]);
  const parsed = parsePostImage(`data:image/png;base64,${bytes.toString("base64")}`, PACK_IMAGE_MAX_BYTES);
  assert.ok(parsed, "a test picture");
  return parsed;
};

let store: Store;
let images: ReturnType<typeof memoryImageStore>;
let deps: PackDeps;

beforeEach(async () => {
  store = memoryStore();
  images = memoryImageStore();
  deps = { images, admins: new Set(["adm"]), now: () => 1_000 };
  await saveRoles(store, token, { owner: "own", moderators: ["mod"] });
});

describe("shortcodes", () => {
  const item = (name: string, kind: "emoji" | "sticker" = "emoji"): PackItem => ({ name, kind, url: `/${name}` });
  const known = new Map([item("chog_wave"), item("gm", "sticker"), item("wow_2")].map((i) => [i.name, i]));

  it("names are 2 to 24 lowercase letters, digits or _, with a letter", () => {
    for (const ok of ["gm", "chog_wave", "a1", "wow_2", "x".repeat(24)]) assert.ok(PACK_NAME.test(ok), ok);
    for (const bad of ["", "g", "30", "_1", "Gm", "a-b", "a b", "x".repeat(25), "é1"]) assert.ok(!PACK_NAME.test(bad), bad);
  });

  it("cuts a text into plain pieces and the Club's pictures", () => {
    assert.deepEqual(splitShortcodes("hello :chog_wave: and :gm:!", known), ["hello ", item("chog_wave"), " and ", item("gm", "sticker"), "!"]);
    assert.deepEqual(splitShortcodes(":gm:", known), [item("gm", "sticker")]);
    assert.deepEqual(splitShortcodes(":chog_wave::wow_2:", known), [item("chog_wave"), item("wow_2")], "side by side");
  });

  it("leaves a name the Club doesn't have, and times, as the text they are", () => {
    assert.deepEqual(splitShortcodes("at 10:30:45 :nope: :GM:", known), ["at 10:30:45 :nope: :GM:"]);
    assert.deepEqual(splitShortcodes("plain", known), ["plain"]);
    assert.deepEqual(splitShortcodes("", known), []);
  });

  it("says whether a text could name one, so a plain post fetches nothing", () => {
    assert.ok(mentionsPack("hi :gm:"));
    assert.ok(!mentionsPack("no colons here"));
    assert.ok(!mentionsPack("a : b : c"));
  });
});

describe("addToPack", () => {
  it("lets the Owner, a Moderator and an app admin add, and keeps the picture under the Club", async () => {
    for (const [who, name] of [
      [owner, "from_owner"],
      [mod, "from_mod"],
      [admin, "from_admin"],
    ] as const) {
      const r = await addToPack(store, club, who, { name, kind: "emoji", picture: pic(name.length) }, deps);
      assert.ok(r.ok, `${who.userId}: ${JSON.stringify(r)}`);
    }
    const kept = await loadPack(store, token);
    assert.deepEqual(kept.map((e) => e.name).sort(), ["from_admin", "from_mod", "from_owner"]);
    assert.equal(images.keys().length, 3);
    assert.ok(images.keys().every((k) => k.startsWith(`club-pack/10143/${token}/`)));
    assert.deepEqual((await readLog(store, token)).map((e) => [e.action, e.target]).sort(), [
      ["add_pack", "from_admin"],
      ["add_pack", "from_mod"],
      ["add_pack", "from_owner"],
    ]);
  });

  it("refuses a member, a stranger and an archived Club", async () => {
    for (const who of [member, { userId: "stranger", wallet: "0x1" }]) {
      assert.deepEqual(await addToPack(store, club, who, { name: "nope", kind: "emoji", picture: pic() }, deps), { ok: false, reason: "forbidden" });
    }
    assert.deepEqual(await addToPack(store, archived, owner, { name: "nope", kind: "emoji", picture: pic() }, deps), { ok: false, reason: "archived" });
    assert.deepEqual(images.keys(), []);
  });

  it("refuses a bad name, kind or picture, and a store that is missing or failing", async () => {
    const add = (over: object, d = deps) => addToPack(store, club, owner, { name: "ok_name", kind: "emoji", picture: pic(), ...over }, d);
    for (const name of ["", "A", "30", "a b", 5, undefined]) assert.deepEqual(await add({ name }), { ok: false, reason: "bad_name" }, String(name));
    for (const kind of ["gif", "", 1, undefined]) assert.deepEqual(await add({ kind }), { ok: false, reason: "bad_pack_kind" });
    assert.deepEqual(await add({ picture: null }), { ok: false, reason: "bad_image" });
    assert.deepEqual(await add({}, { ...deps, images: null }), { ok: false, reason: "images_unavailable" });
    assert.deepEqual(await add({}, { ...deps, images: { ...images, put: async () => Promise.reject(new Error("down")) } }), {
      ok: false,
      reason: "images_unavailable",
    });
    assert.deepEqual(await loadPack(store, token), [], "nothing is listed that wasn't stored");
  });

  it("holds the picture to the pack's size, not the post's", () => {
    const big = Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(PACK_IMAGE_MAX_BYTES + 1, 1)]);
    assert.equal(parsePostImage(`data:image/png;base64,${big.toString("base64")}`, PACK_IMAGE_MAX_BYTES), null);
    assert.ok(parsePostImage(`data:image/png;base64,${big.toString("base64")}`), "a post's picture may be that big");
  });

  it("stops at 50 emoji and 20 stickers, each counted apart, and lets a full pack replace one", async () => {
    for (let i = 0; i < PACK_EMOJI_MAX; i++) assert.ok((await addToPack(store, club, owner, { name: `emoji_${i}`, kind: "emoji", picture: pic(i) }, deps)).ok);
    assert.deepEqual(await addToPack(store, club, owner, { name: "one_more", kind: "emoji", picture: pic(99) }, deps), { ok: false, reason: "pack_full" });
    for (let i = 0; i < PACK_STICKER_MAX; i++)
      assert.ok((await addToPack(store, club, owner, { name: `sticker_${i}`, kind: "sticker", picture: pic(100 + i) }, deps)).ok);
    assert.deepEqual(await addToPack(store, club, owner, { name: "one_more", kind: "sticker", picture: pic(199) }, deps), { ok: false, reason: "pack_full" });
    const replaced = await addToPack(store, club, owner, { name: "emoji_0", kind: "emoji", picture: pic(300) }, deps);
    assert.ok(replaced.ok && replaced.replaced);
    assert.equal((await loadPack(store, token)).length, PACK_EMOJI_MAX + PACK_STICKER_MAX);
  });

  it("keeps a name to one kind", async () => {
    assert.ok((await addToPack(store, club, owner, { name: "shared", kind: "emoji", picture: pic(1) }, deps)).ok);
    assert.deepEqual(await addToPack(store, club, owner, { name: "shared", kind: "sticker", picture: pic(2) }, deps), { ok: false, reason: "name_taken" });
  });

  it("replaces a picture without leaving the old one behind or serving it from a cache", async () => {
    const first = await addToPack(store, club, owner, { name: "wave", kind: "emoji", picture: pic(1) }, deps);
    assert.ok(first.ok && !first.replaced);
    const [before] = await loadPack(store, token);
    const second = await addToPack(store, club, mod, { name: "wave", kind: "emoji", picture: pic(2) }, deps);
    assert.ok(second.ok && second.replaced);
    const [after] = await loadPack(store, token);
    assert.equal(images.keys().length, 1, "the old picture was deleted");
    assert.notEqual(packImageUrl(token, before!), packImageUrl(token, after!), "the address changes with the picture");
    assert.equal(after!.by, mod.wallet);
    assert.deepEqual((await readLog(store, token)).map((e) => e.detail).sort(), ["emoji", "emoji (replaced)"]);
  });

  it("shows readers what to draw and where, and not who added it", async () => {
    await addToPack(store, club, owner, { name: "wave", kind: "emoji", picture: pic(1) }, deps);
    const items = packItems(token, await loadPack(store, token));
    assert.deepEqual(Object.keys(items[0]!).sort(), ["kind", "name", "url"]);
    assert.ok(!JSON.stringify(items).includes(owner.wallet));
  });
});

describe("removeFromPack and readPackImage", () => {
  beforeEach(async () => {
    assert.ok((await addToPack(store, club, owner, { name: "wave", kind: "emoji", picture: pic(1) }, deps)).ok);
  });

  it("serves a picture to anyone, with the type it was stored as", async () => {
    const r = await readPackImage(store, club, "wave", deps);
    assert.ok(r.ok);
    assert.equal(r.type, "image/png");
    assert.deepEqual(await readPackImage(store, club, "nope", deps), { ok: false, reason: "not_found" });
    assert.deepEqual(await readPackImage(store, club, "wave", { ...deps, images: null }), { ok: false, reason: "images_unavailable" });
    assert.deepEqual(await readPackImage(store, club, "wave", { ...deps, images: { ...images, get: async () => Promise.reject(new Error("down")) } }), {
      ok: false,
      reason: "images_unavailable",
    });
  });

  it("lets staff remove one, takes its picture with it, and logs it", async () => {
    assert.deepEqual(await removeFromPack(store, club, member, "wave", deps), { ok: false, reason: "forbidden" });
    assert.deepEqual(await removeFromPack(store, club, mod, "nope", deps), { ok: false, reason: "not_found" });
    const r = await removeFromPack(store, club, mod, "wave", deps);
    assert.ok(r.ok);
    assert.deepEqual(r.items, []);
    assert.deepEqual(images.keys(), []);
    assert.deepEqual(await readPackImage(store, club, "wave", deps), { ok: false, reason: "not_found" });
    assert.ok((await readLog(store, token)).some((e) => e.action === "remove_pack" && e.target === "wave"));
  });

  it("is allowed in an archived Club, as other clean-up is", async () => {
    await saveRoles(store, OLD.toLowerCase(), { owner: "own", moderators: [] });
    await store.set(`declub:club-pack:10143:${OLD.toLowerCase()}`, [
      { name: "wave", kind: "emoji", type: "image/png", size: 1, hash: `0x${"ab".repeat(32)}`, at: 1, by: owner.wallet },
    ]);
    assert.ok((await removeFromPack(store, archived, owner, "wave", deps)).ok);
  });
});

describe("a Club's pack when the Club is purged", () => {
  it("goes with it, pictures and all", async () => {
    await addToPack(store, club, owner, { name: "one", kind: "emoji", picture: pic(1) }, deps);
    await addToPack(store, club, owner, { name: "two", kind: "sticker", picture: pic(2) }, deps);
    assert.equal(images.keys().length, 2);
    await purgeClub(store, NFT, deps);
    assert.deepEqual(images.keys(), []);
    assert.deepEqual(await loadPack(store, token), []);
  });

  it("can be cleared on its own, and says how many", async () => {
    await addToPack(store, club, owner, { name: "one", kind: "emoji", picture: pic(1) }, deps);
    assert.equal(await purgePack(store, token, deps), 1);
    assert.equal(await purgePack(store, token, deps), 0);
  });
});

describe("the built-in stickers", () => {
  const dir = new URL("../public/stickers/", import.meta.url);
  const files = readdirSync(dir).sort();

  it("are 12 valid, distinct names, each a sticker with a file, and no file without a name", () => {
    assert.equal(DEFAULT_STICKER_NAMES.length, 12);
    assert.equal(new Set(DEFAULT_STICKER_NAMES).size, DEFAULT_STICKER_NAMES.length);
    for (const name of DEFAULT_STICKER_NAMES) assert.ok(PACK_NAME.test(name), name);
    assert.ok(DEFAULT_STICKERS.every((s) => s.kind === "sticker" && s.url === `/stickers/${s.name}.svg`));
    assert.deepEqual(files, DEFAULT_STICKER_NAMES.map((n) => `${n}.svg`).sort(), "brand/build/stickers.py and DEFAULT_STICKER_NAMES agree");
  });

  it("carry nothing but shapes: no script, handler, link, image, style or external reference", () => {
    for (const file of files) {
      const svg = readFileSync(new URL(file, dir), "utf8");
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512"/, file);
      assert.ok(svg.length < 20_000, `${file} is ${svg.length} bytes`);
      for (const bad of [/<script/i, /\bon\w+\s*=/i, /href\s*=/i, /<image/i, /<foreignObject/i, /<style/i, /url\(/i, /javascript:/i, /<use/i, /<!ENTITY/i]) {
        assert.ok(!bad.test(svg), `${file} has ${bad}`);
      }
    }
  });

  it("are every Club's, until the Club adds the same name, which replaces them for it", () => {
    const all = withDefaults([]);
    assert.deepEqual(
      all.map((i) => i.name),
      [...DEFAULT_STICKER_NAMES],
    );
    const own: PackItem = { name: "gm", kind: "emoji", url: "/mine" };
    const mixed = withDefaults([own, { name: "chog_wave", kind: "emoji", url: "/wave" }]);
    assert.equal(mixed.length, DEFAULT_STICKER_NAMES.length + 1, "one replaced, one added");
    assert.deepEqual(
      mixed.slice(0, 2).map((i) => i.name),
      ["gm", "chog_wave"],
      "the Club's own come first",
    );
    assert.equal(mixed.filter((i) => i.name === "gm").length, 1);
    assert.equal(mixed.find((i) => i.name === "gm")!.url, "/mine");
  });

  it("are drawn in a post by name, like a Club's own", () => {
    const known = new Map(withDefaults([]).map((i) => [i.name, i]));
    assert.deepEqual(splitShortcodes("say :gm: to :gem:", known), ["say ", known.get("gm")!, " to ", known.get("gem")!]);
    assert.deepEqual(splitShortcodes(":gm:", known), [known.get("gm")!]);
  });
});
