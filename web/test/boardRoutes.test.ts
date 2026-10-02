import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileKey, userWalletsKey } from "../lib/profiles";
import type { UserGate } from "../lib/server/gate";
import { claimHandler, bansHandlers, deletePostHandler, hideHandler, logHandler, pinHandler, postsHandlers, profileHandlers, purgeHandler, reportHandler, rolesHandler } from "../lib/server/boardRoutes";
import { joinClub } from "../lib/server/members";
import { membershipHandlers } from "../lib/server/memberRoutes";
import { getStore } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const BLOCKED = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const reg = makeRegistry(parseAssets([
  { chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." },
  { chainId: 10143, address: BLOCKED, kind: "erc721", name: "B", symbol: "B", status: "blocked", note: "Scam." },
]));
const store = getStore()!;
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const account = (n: number) => ({ type: "wallet", chain_type: "ethereum", address: wallet(n) });

const users: Record<string, number> = { own: 1, mod: 2, m1: 3, m2: 4, adm: 9 };
let current = "m1";
/** The caller is whoever `as(...)` last named. */
const gate = async (): Promise<UserGate> =>
  ({ store, user: { id: current, linked_accounts: [account(users[current] ?? 50)] } }) as unknown as UserGate;
const viewer = async (request: Request) => (request.headers.get("authorization") === "Bearer none" ? null : { id: current });
const deps = { gate, viewer, admins: new Set(["adm"]), ownerOf: async () => wallet(1), now: () => 1_000_000 };
const as = (id: string) => void (current = id);

const ctx = (token = NFT) => ({ params: Promise.resolve({ token }) });
const item = (id: string, token = NFT) => ({ params: Promise.resolve({ token, id }) });
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", { method, headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

const posts = postsHandlers(reg, deps);
const post = async (text: string, extra: Record<string, unknown> = {}) => {
  await store.del(`ondeal:rl:club-post-cd:${NFT.toLowerCase()}:${current}`, `ondeal:rl:club-post-hr:${NFT.toLowerCase()}:${current}`);
  return posts.POST(req("POST", { kind: "note", text, ...extra }), ctx());
};

describe("setup", () => {
  it("members with shared profiles", async () => {
    for (const [id, n] of Object.entries(users)) {
      await store.set(profileKey(wallet(n)), { provider: "twitter", handle: `u${n}`, userId: id, updatedAt: 1 });
      await store.setMembers(userWalletsKey(id), [wallet(n)]);
      assert.ok((await joinClub(store, reg.clubFor(NFT)!, id, [wallet(n)], { holdings: async () => [0n] })).ok);
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
    const ok = await post("  hello   club ");
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).post.text, "hello club");
    assert.equal((await post("")).status, 400);
    assert.equal((await post("x".repeat(281))).status, 400);
    assert.equal((await post("x", { link: "5" })).status, 400);
    // Refused posts used up no cooldown, so one more goes through; the one right after waits.
    assert.equal((await posts.POST(req("POST", { kind: "note", text: "again" }), ctx())).status, 201);
    assert.equal((await posts.POST(req("POST", { kind: "note", text: "too soon" }), ctx())).status, 429, "the cooldown");
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
  it("hides after three reports", async () => {
    as("m1");
    await store.del(`ondeal:rl:club-post-cd:${NFT.toLowerCase()}:m1`);
    id = (await (await post("report me")).json()).post.id;
    const report = reportHandler(reg, deps);
    as("m1");
    assert.equal((await report(req("POST"), item(id))).status, 409, "own post");
    for (const who of ["m2", "mod", "own"]) {
      as(who);
      const res = await report(req("POST"), item(id));
      assert.equal(res.status, 200);
      if (who === "own") assert.equal((await res.json()).hidden, true);
    }
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
    assert.deepEqual((await (await bans.GET(req("GET"), ctx())).json()).club.map((b: { wallet: string }) => b.wallet), [wallet(3)]);
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
