import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { profileKey, userWalletsKey } from "../lib/profiles";
import type { UserGate } from "../lib/server/gate";
import {
  claimHandler,
  bansHandlers,
  deletePostHandler,
  hideHandler,
  logHandler,
  packHandlers,
  packImageHandler,
  pinHandler,
  postImageHandler,
  postsHandlers,
  profileHandlers,
  purgeHandler,
  reportHandler,
  reportedHandler,
  rolesHandler,
  xLinkHandlers,
} from "../lib/server/boardRoutes";
import { saveRoles } from "../lib/server/clubState";
import { joinClub } from "../lib/server/members";
import { membershipHandlers } from "../lib/server/memberRoutes";
import { memoryImageStore, parsePostImage } from "../lib/server/postImages";
import { getStore } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const BLOCKED = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const reg = makeRegistry(
  parseAssets([
    { chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." },
    { chainId: 10143, address: BLOCKED, kind: "erc721", name: "B", symbol: "B", status: "blocked", note: "Scam." },
  ]),
);
const store = getStore()!;
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const account = (n: number) => ({ type: "wallet", chain_type: "ethereum", address: wallet(n) });

const users: Record<string, number> = { own: 1, mod: 2, m1: 3, m2: 4, adm: 9 };
let current = "m1";
/** The caller is whoever `as(...)` last named. */
const gate = async (): Promise<UserGate> => ({ store, user: { id: current, linked_accounts: [account(users[current] ?? 50)] } }) as unknown as UserGate;
const viewer = async (request: Request) => (request.headers.get("authorization") === "Bearer none" ? null : { id: current });
// The test wallets have no keys, so signatures are taken as valid here; test/social.test.ts checks
// real ones.
const deps = { gate, viewer, admins: new Set(["adm"]), ownerOf: async () => wallet(1), now: () => 1_000_000, verifyPost: async () => true };
const as = (id: string) => void (current = id);

const ctx = (token = NFT) => ({ params: Promise.resolve({ token }) });
const item = (id: string, token = NFT) => ({ params: Promise.resolve({ token, id }) });
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const posts = postsHandlers(reg, deps);
/** A post as the client sends it: the message to sign, at the test clock's time, and a signature. */
const signed = (text: string, extra: { kind?: "note" | "looking"; link?: string } = {}) => ({
  message: { club: NFT, kind: extra.kind ?? "note", text, link: extra.link ?? "", at: 1_000 },
  signature: `0x${"11".repeat(65)}`,
});
const post = async (text: string, extra: { kind?: "note" | "looking"; link?: string } = {}) => {
  await store.del(`declub:rl:club-post-cd:${NFT.toLowerCase()}:${current}`, `declub:rl:club-post-hr:${NFT.toLowerCase()}:${current}`);
  return posts.POST(req("POST", signed(text, extra)), ctx());
};

describe("setup", () => {
  it("members with shared profiles", async () => {
    for (const [id, n] of Object.entries(users)) {
      await store.set(profileKey(wallet(n)), { provider: "twitter", handle: `u${n}`, userId: id, updatedAt: 1 });
      await store.setMembers(userWalletsKey(id), [wallet(n)]);
      // m2 holds the token: only Holders' (and staff's) reports count toward hiding a post.
      assert.ok((await joinClub(store, reg.clubFor(NFT)!, id, [wallet(n)], { holdings: async () => [id === "m2" ? 1n : 0n] })).ok);
    }
  });
});

describe("claim, roles and the Owner", () => {
  it("lets the wallet that is owner() claim, shows the role on the membership, and refuses others", async () => {
    as("m1");
    const refused = await claimHandler(reg, deps)(req("POST"), ctx());
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error, "not_owner");
    as("own");
    const ok = await claimHandler(reg, deps)(req("POST"), ctx());
    assert.equal(ok.status, 200);
    const m = membershipHandlers(reg, deps);
    assert.equal((await (await m.GET(req("GET"), ctx())).json()).role, "owner");
    as("m1");
    assert.equal((await (await m.GET(req("GET"), ctx())).json()).role, "member");
    as("adm");
    assert.equal((await (await m.GET(req("GET"), ctx())).json()).role, "admin");
    as("outsider");
    const visitor = await (await m.GET(req("GET"), ctx())).json();
    assert.deepEqual(visitor, { enabled: true, member: false }, "a visitor learns no role");
  });

  it("keeps the Owner from leaving without handing over", async () => {
    as("own");
    const m = membershipHandlers(reg, deps);
    const res = await m.DELETE(req("DELETE"), ctx());
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "owner_cannot_leave");
  });

  it("lets the Owner appoint a Moderator, and no one else", async () => {
    const roles = rolesHandler(reg, deps);
    as("m1");
    assert.equal((await roles(req("PUT", { wallet: wallet(2), role: "moderator" }), ctx())).status, 403);
    as("own");
    assert.equal((await roles(req("PUT", { wallet: wallet(2), role: "moderator" }), ctx())).status, 200);
    assert.equal((await roles(req("PUT", { wallet: wallet(2), role: "moderator" }), ctx())).status, 409);
    assert.equal((await roles(req("PUT", { wallet: wallet(2), role: "boss" }), ctx())).status, 400);
    assert.equal((await roles(req("PUT", { role: "moderator" }), ctx())).status, 400);
    assert.equal((await roles(req("PUT", { wallet: wallet(77), role: "moderator" }), ctx())).status, 404);
  });
});

describe("posting and reading", () => {
  it("creates a post (201) and answers refusals with the right status", async () => {
    as("m1");
    const ok = await post("hello club");
    assert.equal(ok.status, 201);
    const created = (await ok.json()).post;
    assert.equal(created.text, "hello club");
    assert.equal(created.signed, true);
    assert.match(created.id, /^[0-9a-f]{64}$/, "a signed post's id is its struct hash");
    assert.equal((await post("")).status, 400);
    assert.equal((await post("x".repeat(281))).status, 400);
    assert.equal((await post("x", { link: "5" })).status, 400);
    // What was signed must be what is stored: untrimmed text is refused, not cleaned.
    assert.equal((await (await post("  hello   club ")).json()).error, "not_clean");
    // An unsigned post (the old form) is refused.
    assert.equal((await (await posts.POST(req("POST", { kind: "note", text: "plain" }), ctx())).json()).error, "unsigned");
    // A signature from long ago is refused.
    assert.equal((await (await posts.POST(req("POST", { ...signed("old"), message: { ...signed("old").message, at: 1 } }), ctx())).json()).error, "stale");
    // Refused posts used up no cooldown, so one more goes through; the one right after waits.
    assert.equal((await posts.POST(req("POST", signed("again")), ctx())).status, 201);
    assert.equal((await posts.POST(req("POST", signed("too soon")), ctx())).status, 429, "the cooldown");
    as("stranger");
    assert.equal((await post("hi")).status, 403);
  });

  it("serves the board publicly and cacheable, and privately for a signed-in reader", async () => {
    const anon = await posts.GET(req("GET"), ctx());
    assert.equal(anon.status, 200);
    assert.match(anon.headers.get("cache-control") ?? "", /s-maxage/);
    const body = await anon.json();
    assert.equal(body.role, null);
    assert.ok(body.posts.length >= 1);
    assert.ok(!JSON.stringify(body).includes('"userId"'), "no user ids");

    as("mod");
    const signed = await posts.GET(req("GET", undefined, { authorization: "Bearer t" }), ctx());
    assert.match(signed.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await signed.json()).role, "moderator");
  });

  it("answers 404 for a blocked or unknown asset", async () => {
    assert.equal((await posts.GET(req("GET"), ctx(BLOCKED))).status, 404);
    assert.equal((await posts.GET(req("GET"), ctx("nope"))).status, 400);
  });
});

describe("reports, hiding, pinning, deleting", () => {
  let id = "";
  it("flags a post for the moderators after reports, and a moderator hides it", async () => {
    as("m1");
    await store.del(`declub:rl:club-post-cd:${NFT.toLowerCase()}:m1`);
    id = (await (await post("report me")).json()).post.id;
    const report = reportHandler(reg, deps);
    as("m1");
    assert.equal((await report(req("POST"), item(id))).status, 409, "own post");
    for (const who of ["m2", "mod", "own"]) {
      as(who);
      const res = await report(req("POST"), item(id));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).hidden, false, "reports never hide a post");
    }
    as("m2");
    const visible = (await (await posts.GET(req("GET", undefined, { authorization: "Bearer t" }), ctx())).json()).posts.find(
      (p: { id: string }) => p.id === id,
    );
    assert.equal(visible.text, "report me");

    const reported = reportedHandler(reg, deps);
    as("m2");
    assert.equal((await reported(req("GET"), ctx())).status, 403, "members can't read the Reported list");
    as("mod");
    const list = (await (await reported(req("GET"), ctx())).json()) as { reported: { post: { id: string }; reports: number }[] };
    assert.deepEqual(
      list.reported.map((r) => [r.post.id, r.reports]),
      [[id, 3]],
    );

    assert.equal((await hideHandler(reg, deps)(req("POST", { hidden: true }), item(id))).status, 200);
    as("m2");
    const seen = (await (await posts.GET(req("GET", undefined, { authorization: "Bearer t" }), ctx())).json()).posts.find((p: { id: string }) => p.id === id);
    assert.equal(seen.text, null);
  });

  it("lets staff restore it, and only staff", async () => {
    const hide = hideHandler(reg, deps);
    as("m2");
    assert.equal((await hide(req("POST", { hidden: false }), item(id))).status, 403);
    as("mod");
    assert.equal((await hide(req("POST", { hidden: "no" }), item(id))).status, 400);
    assert.equal((await hide(req("POST", { hidden: false }), item(id))).status, 200);
  });

  it("lets the Owner pin and unpin, not a Moderator", async () => {
    const pin = pinHandler(reg, deps);
    as("mod");
    assert.equal((await pin(req("POST", { pinned: true }), item(id))).status, 403);
    as("own");
    assert.equal((await pin(req("POST", { pinned: true }), item(id))).status, 200);
    const list = (await (await posts.GET(req("GET"), ctx())).json()).posts;
    assert.equal(list[0].id, id);
    assert.equal(list[0].pinned, true);
    assert.equal((await pin(req("POST", { pinned: "yes" }), item(id))).status, 400);
  });

  it("deletes: not another member's post, but the author's own or staff's", async () => {
    const del = deletePostHandler(reg, deps);
    as("m2");
    assert.equal((await del(req("DELETE"), item(id))).status, 403);
    as("mod");
    assert.equal((await del(req("DELETE"), item(id))).status, 200);
    assert.equal((await del(req("DELETE"), item(id))).status, 404);
    assert.equal((await del(req("DELETE"), item("not-an-id"))).status, 404);
  });
});

describe("bans, the profile and the log", () => {
  it("bans, lists and unbans", async () => {
    const bans = bansHandlers(reg, deps);
    as("m2");
    assert.equal((await bans.POST(req("POST", { wallet: wallet(3) }), ctx())).status, 403);
    assert.equal((await bans.GET(req("GET"), ctx())).status, 403);
    as("mod");
    assert.equal((await bans.POST(req("POST", { wallet: wallet(1) }), ctx())).status, 403, "not the Owner");
    assert.equal((await bans.POST(req("POST", { wallet: wallet(3) }), ctx())).status, 200);
    assert.deepEqual(
      (await (await bans.GET(req("GET"), ctx())).json()).club.map((b: { wallet: string }) => b.wallet),
      [wallet(3)],
    );
    as("m1");
    assert.equal((await membershipHandlers(reg, deps).POST(req("POST"), ctx())).status, 403, "can't rejoin");
    as("mod");
    assert.equal((await bans.DELETE(req("DELETE", {}), ctx())).status, 400);
    assert.equal((await bans.DELETE(req("DELETE", { wallet: wallet(3) }), ctx())).status, 200);
  });

  it("edits the profile as Owner, shows it publicly, and refuses bad links", async () => {
    const profile = profileHandlers(reg, deps);
    as("m2");
    assert.equal((await profile.PATCH(req("PATCH", { description: "x" }), ctx())).status, 403);
    as("own");
    assert.equal((await profile.PATCH(req("PATCH", { links: ["javascript:alert(1)"] }), ctx())).status, 400);
    const ok = await profile.PATCH(req("PATCH", { description: "Welcome", links: ["https://example.com"], holdersOnlyPosts: false }), ctx());
    assert.equal(ok.status, 200);
    const pub = await (await profile.GET(req("GET"), ctx())).json();
    assert.deepEqual({ d: pub.description, l: pub.links, o: pub.hasOwner }, { d: "Welcome", l: ["https://example.com/"], o: true });
    assert.ok(!("pinned" in pub) && !("ownerClaim" in pub));
  });

  it("shows the log to staff, and the ownership check to admins only", async () => {
    const log = logHandler(reg, deps);
    as("m2");
    assert.equal((await log(req("GET"), ctx())).status, 403);
    as("mod");
    const staff = await (await log(req("GET"), ctx())).json();
    assert.ok(staff.log.length > 0);
    assert.equal(staff.ownership, null);
    as("adm");
    const admin = await (await log(req("GET"), ctx())).json();
    assert.equal(admin.ownership.changed, false);
  });
});

describe("purge", () => {
  it("is for admins, and only for a Club that is hidden from the list", async () => {
    const purge = purgeHandler(reg, deps);
    as("own");
    assert.equal((await purge(req("DELETE"), ctx(BLOCKED))).status, 403);
    as("adm");
    assert.equal((await purge(req("DELETE"), ctx(NFT))).status, 409, "a live Club can't be purged");
    assert.equal((await purge(req("DELETE"), ctx("nope"))).status, 400);
    await joinClub(store, { ...reg.entry(BLOCKED)!, club: undefined }, "m1", [wallet(3)], { holdings: async () => [0n] });
    const res = await purge(req("DELETE"), ctx(BLOCKED));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).purged.members, 1);
  });
});

describe("X posts and the project's X account (ADR 0024)", () => {
  const NOW_MS = 1_800_000_000_000;
  /** An X post id made a minute before the test clock. */
  const fresh = (((BigInt(NOW_MS - 60_000) - 1_288_834_974_657n) << 22n) + 7n).toString();
  const x: Record<string, { author: string; text: string }> = { [fresh]: { author: "m2_on_x", text: `gm ${NFT}` } };
  const xDeps = {
    ...deps,
    now: () => NOW_MS,
    lookupX: async (id: string) => (x[id] ? { id, author: x[id].author, text: x[id].text, postedAt: NOW_MS - 60_000 } : null),
    xAccountOf: async (userId: string) => (userId === "m2" ? { username: "m2_on_x", subject: "22" } : null),
    xUserIdOf: async () => null,
  };
  const xPosts = postsHandlers(reg, xDeps);
  const share = async (id: string) => {
    await store.del(`declub:rl:club-post-cd:${NFT.toLowerCase()}:${current}`, `declub:rl:club-post-hr:${NFT.toLowerCase()}:${current}`);
    const message = { club: NFT, kind: "note", text: "look", link: `https://x.com/i/status/${id}`, at: NOW_MS / 1000 };
    return xPosts.POST(req("POST", { message, signature: `0x${"11".repeat(65)}` }), ctx());
  };

  it("tells the author whether their X post counted", async () => {
    as("m2");
    const res = await share(fresh);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(body.xShare, { own: true, counted: "strong" });
    assert.equal(body.post.x.author, "m2_on_x");
    assert.equal((await share("12345")).status, 404, "a post X doesn't have");
  });

  it("links the project's account for the Owner only, by a post with the code", async () => {
    const xl = xLinkHandlers(reg, xDeps);
    as("m1");
    assert.equal((await xl.POST(req("POST", { action: "start", handle: "ChogNFT" }), ctx())).status, 403);
    as("own");
    const started = await (await xl.POST(req("POST", { action: "start", handle: "ChogNFT" }), ctx())).json();
    assert.ok(started.text.includes(started.code));
    x["900"] = { author: "ChogNFT", text: started.text };
    const linked = await xl.POST(req("POST", { action: "verify", handle: "ChogNFT", url: "https://x.com/ChogNFT/status/900" }), ctx());
    assert.equal(linked.status, 200);

    const page = await (await profileHandlers(reg, deps).GET(req("GET"), ctx())).json();
    assert.deepEqual(
      page.x.accounts.map((a: { handle: string }) => a.handle),
      ["ChogNFT"],
    );
    assert.match(page.x.hint, /@chognft/);
    assert.equal(JSON.stringify(page).includes("xUserId"), false);

    assert.equal((await xl.POST(req("POST", { action: "nope" }), ctx())).status, 400);
    assert.equal((await xl.DELETE(req("DELETE", { handle: "ChogNFT" }), ctx())).status, 200);
    assert.equal((await xl.DELETE(req("DELETE", { handle: "ChogNFT" }), ctx())).status, 404);
  });
});

describe("post pictures", () => {
  // Their own members, so what the tests above did to the others (bans, a purge) can't reach these.
  before(async () => {
    Object.assign(users, { pic1: 61, pic2: 62, picmod: 63 });
    for (const id of ["pic1", "pic2", "picmod"]) {
      const n = users[id]!;
      await store.set(profileKey(wallet(n)), { provider: "twitter", handle: `u${n}`, userId: id, updatedAt: 1 });
      await store.setMembers(userWalletsKey(id), [wallet(n)]);
      assert.ok((await joinClub(store, reg.clubFor(NFT)!, id, [wallet(n)], { holdings: async () => [0n] })).ok);
    }
    await saveRoles(store, NFT.toLowerCase(), { owner: "own", moderators: ["picmod"] });
  });
  const images = memoryImageStore();
  const withImages = { ...deps, images };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 5)]);
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const pic = parsePostImage(dataUrl)!;
  const send = (extra: Record<string, unknown>) => {
    const body = signed("with a picture");
    return postsHandlers(reg, withImages).POST(req("POST", { ...body, message: { ...body.message, image: pic.hash }, ...extra }), ctx());
  };

  it("takes a signed picture beside the message, and serves it with headers that keep it a picture", async () => {
    as("pic1");
    await store.del(`declub:rl:club-post-cd:${NFT.toLowerCase()}:pic1`, `declub:rl:club-post-hr:${NFT.toLowerCase()}:pic1`);
    const created = await send({ image: dataUrl });
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    const { post } = await created.json();
    assert.equal(post.image.type, "image/png");

    const served = await postImageHandler(reg, withImages)(req("GET", undefined, { authorization: "Bearer none" }), item(post.id));
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.match(served.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.match(served.headers.get("cache-control") ?? "", /public/);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);

    const signedIn = await postImageHandler(reg, withImages)(req("GET", undefined, { authorization: "Bearer t" }), item(post.id));
    assert.match(signedIn.headers.get("cache-control") ?? "", /no-store/, "a reader's answer is never shared");
  });

  it("answers the refusals with their statuses", async () => {
    as("pic1");
    const reset = () => store.del(`declub:rl:club-post-cd:${NFT.toLowerCase()}:pic1`, `declub:rl:club-post-hr:${NFT.toLowerCase()}:pic1`);
    await reset();
    assert.equal((await send({})).status, 422, "signed over a picture that wasn't sent");
    await reset();
    assert.equal((await send({ image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).status, 422, "SVG is never taken");
    await reset();
    const noStore = await postsHandlers(reg, { ...deps, images: null }).POST(
      req("POST", { ...signed("x"), message: { ...signed("x").message, image: pic.hash }, image: dataUrl }),
      ctx(),
    );
    assert.equal(noStore.status, 503);
    assert.equal((await noStore.json()).error, "images_unavailable");
  });

  it("hides a hidden post's picture from everyone but its author and staff", async () => {
    as("pic1");
    await store.del(`declub:rl:club-post-cd:${NFT.toLowerCase()}:pic1`, `declub:rl:club-post-hr:${NFT.toLowerCase()}:pic1`);
    const body = signed("hide my picture");
    const pic2 = parsePostImage(`data:image/png;base64,${Buffer.concat([png, Buffer.from([1])]).toString("base64")}`)!;
    const created = await postsHandlers(reg, withImages).POST(
      req("POST", {
        ...body,
        message: { ...body.message, image: pic2.hash },
        image: `data:image/png;base64,${Buffer.concat([png, Buffer.from([1])]).toString("base64")}`,
      }),
      ctx(),
    );
    const { post } = await created.json();
    as("picmod");
    assert.equal((await hideHandler(reg, withImages)(req("POST", { hidden: true }), item(post.id))).status, 200);
    const get = postImageHandler(reg, withImages);
    assert.equal((await get(req("GET", undefined, { authorization: "Bearer none" }), item(post.id))).status, 404);
    as("pic2");
    assert.equal((await get(req("GET", undefined, { authorization: "Bearer t" }), item(post.id))).status, 404);
    as("pic1");
    const own = await get(req("GET", undefined, { authorization: "Bearer t" }), item(post.id));
    assert.equal(own.status, 200);
    assert.match(own.headers.get("cache-control") ?? "", /no-store/);
    as("picmod");
    assert.equal((await get(req("GET", undefined, { authorization: "Bearer t" }), item(post.id))).status, 200);
  });
});

describe("club emoji and stickers", () => {
  // Uses the members the post-picture tests made: pic1 is a member, picmod a Moderator.
  const images = memoryImageStore();
  const handlers = packHandlers(reg, { ...deps, images });
  const png = (fill: number, size = 24) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, fill)]);
  const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;
  const named = (name: string) => ({ params: Promise.resolve({ token: NFT, name }) });

  it("lets staff add one, shows it to anyone, and serves its picture as a picture", async () => {
    as("pic1");
    const refused = await handlers.PUT(req("PUT", { name: "chog_wave", kind: "emoji", image: dataUrl(png(1)) }), ctx());
    assert.equal(refused.status, 403, "a member can't add");

    as("picmod");
    const added = await handlers.PUT(req("PUT", { name: "chog_wave", kind: "emoji", image: dataUrl(png(1)) }), ctx());
    assert.equal(added.status, 200, JSON.stringify(await added.clone().json()));
    assert.equal((await added.json()).replaced, false);

    const listed = await handlers.GET(req("GET", undefined, { authorization: "Bearer none" }), ctx());
    assert.equal(listed.status, 200);
    assert.match(listed.headers.get("cache-control") ?? "", /public/);
    const body = await listed.json();
    assert.deepEqual(
      body.pack.map((i: { name: string; kind: string }) => [i.name, i.kind]),
      [["chog_wave", "emoji"]],
    );
    assert.equal(JSON.stringify(body).includes(wallet(63)), false, "who added it stays private");
    assert.equal(body.limits.emoji, 50);
    assert.ok(
      body.builtin.length === 12 && body.builtin.some((i: { name: string; kind: string }) => i.name === "gm" && i.kind === "sticker"),
      "the built-in stickers are listed apart from the Club's own",
    );

    const served = await packImageHandler(reg, { ...deps, images })(req("GET", undefined, { authorization: "Bearer none" }), named("chog_wave"));
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.match(served.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), png(1));
    assert.equal((await packImageHandler(reg, { ...deps, images })(req("GET"), named("missing"))).status, 404);
  });

  it("refuses what isn't acceptable with the right status", async () => {
    as("picmod");
    const put = (body: object, h = handlers) => h.PUT(req("PUT", body), ctx());
    assert.equal((await put({ name: "big", kind: "emoji", image: dataUrl(png(2, 300_000)) })).status, 422, "over 256 KB");
    assert.equal((await put({ name: "svg", kind: "emoji", image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).status, 422);
    assert.equal((await put({ name: "x", kind: "emoji", image: dataUrl(png(3)) })).status, 400, "name too short");
    assert.equal((await put({ name: "fine", kind: "gif", image: dataUrl(png(3)) })).status, 400, "unknown kind");
    const noStore = await put({ name: "fine", kind: "emoji", image: dataUrl(png(3)) }, packHandlers(reg, { ...deps, images: null }));
    assert.equal(noStore.status, 503);
    assert.equal((await noStore.json()).error, "images_unavailable");
  });

  it("lets staff remove one, and not a member", async () => {
    as("pic1");
    assert.equal((await handlers.DELETE(req("DELETE", { name: "chog_wave" }), ctx())).status, 403);
    as("picmod");
    assert.equal((await handlers.DELETE(req("DELETE", { name: "nope_name" }), ctx())).status, 404);
    const removed = await handlers.DELETE(req("DELETE", { name: "chog_wave" }), ctx());
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).pack, []);
    assert.equal((await packImageHandler(reg, { ...deps, images })(req("GET"), named("chog_wave"))).status, 404);
  });
});
