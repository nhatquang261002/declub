import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import type { ActivityEvent } from "../lib/clubs";
import { HOLDER_RECHECK_MS, MAX_MEMBERS, RECHECK_PER_READ, type MemberRow } from "../lib/members";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { activityKey } from "../lib/server/activity";
import type { UserGate } from "../lib/server/gate";
import {
  clubsOf,
  getMember,
  holderCount,
  joinClub,
  leaveClub,
  listMembers,
  memberKey,
  membersKey,
  syncMemberships,
  type Holdings,
} from "../lib/server/members";
import { handlePrivyEvent } from "../lib/server/privyWebhook";
import { clubProfileKey } from "../lib/server/clubState";
import { membershipHandlers, membersHandler, myClubsHandler } from "../lib/server/memberRoutes";
import { getStore, memoryStore } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const COIN = "0xd300f095f456D59AAc122B0100833fE195136F6c";
const PETS = "0x0000000000000000000000000000000000000077";
const OLD = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
const NOCLUB = "0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298";
const W1 = "0x00000000000000000000000000000000000000a1";
const W2 = "0x00000000000000000000000000000000000000b2";
const entry = (address: string, over: Record<string, unknown> = {}) => ({
  chainId: 10143,
  address,
  kind: "erc721",
  name: "Name",
  symbol: "SYM",
  status: "verified",
  note: "Why.",
  ...over,
});
const reg = makeRegistry(parseAssets([entry(NFT), entry(PETS), entry(OLD, { club: "archived" }), entry(NOCLUB, { club: false })]));
const club = reg.clubFor(NFT)!;
const pets = reg.clubFor(PETS)!;
const archived = reg.clubFor(OLD)!;

/** Holdings that answer from a table of balances by wallet, and count the reads made. */
function holdings(balances: Record<string, bigint>) {
  const calls: { token: string; wallets: string[] }[] = [];
  const fn: Holdings = async (token, wallets) => {
    calls.push({ token, wallets: [...wallets] });
    return wallets.map((w) => balances[w.toLowerCase()] ?? 0n);
  };
  return { fn, calls };
}
const broken: Holdings = async () => null;

describe("a paired Club", () => {
  const paired = makeRegistry(parseAssets([entry(NFT), entry(COIN, { kind: "erc20", category: "memecoin", minHolding: "100", club: NFT })])).clubFor(COIN)!;

  it("makes a holder of either asset a Holder", async () => {
    const byToken =
      (balances: Record<string, bigint>): Holdings =>
      async (token) => [balances[token.toLowerCase()] ?? 0n];
    const coinOnly = await joinClub(memoryStore(), paired, "u1", [W1], { holdings: byToken({ [COIN.toLowerCase()]: 100n }) });
    const nftOnly = await joinClub(memoryStore(), paired, "u1", [W1], { holdings: byToken({ [NFT.toLowerCase()]: 1n }) });
    const tooFew = await joinClub(memoryStore(), paired, "u1", [W1], { holdings: byToken({ [COIN.toLowerCase()]: 99n }) });
    assert.ok(coinOnly.ok && coinOnly.row.holder);
    assert.ok(nftOnly.ok && nftOnly.row.holder);
    assert.ok(tooFew.ok && !tooFew.row.holder);
  });

  it("settles Holder from one asset when the other can't be read, and waits when neither says so", async () => {
    const half =
      (answer: bigint): Holdings =>
      async (token) =>
        token.toLowerCase() === NFT.toLowerCase() ? null : [answer];
    const yes = await joinClub(memoryStore(), paired, "u1", [W1], { holdings: half(100n), now: () => 7 });
    const unsure = await joinClub(memoryStore(), paired, "u1", [W1], { holdings: half(0n), now: () => 7 });
    assert.ok(yes.ok && yes.row.holder && yes.row.holderCheckedAt === 7);
    assert.ok(unsure.ok && !unsure.row.holder && unsure.row.holderCheckedAt === 0, "checked again on the next read");
  });

  it("follows the Owner's coin rule: their minimum, or no coin at all", async () => {
    const byToken =
      (balances: Record<string, bigint>): Holdings =>
      async (token) => [balances[token.toLowerCase()] ?? 0n];
    const coin500 = byToken({ [COIN.toLowerCase()]: 500n });
    const ruled = async (coinHolders: { on: boolean; min: string; at: number }) => {
      const store = memoryStore();
      await store.set(clubProfileKey(NFT), { coinHolders });
      return joinClub(store, paired, "u1", [W1], { holdings: coin500 });
    };
    const raised = await ruled({ on: true, min: "1000", at: 1 });
    const lowered = await ruled({ on: true, min: "500", at: 1 });
    const off = await ruled({ on: false, min: "1", at: 1 });
    assert.ok(raised.ok && !raised.row.holder);
    assert.ok(lowered.ok && lowered.row.holder);
    assert.ok(off.ok && !off.row.holder);
  });

  it("re-checks badges from before the rule changed", async () => {
    const store = memoryStore();
    const nowMs = 10 * HOLDER_RECHECK_MS;
    const byToken: Holdings = async (token) => [token.toLowerCase() === COIN.toLowerCase() ? 500n : 0n];
    await joinClub(store, paired, "u1", [W1], { holdings: byToken, now: () => nowMs - 1000 });
    assert.equal((await getMember(store, NFT, "u1"))?.holder, true);
    await store.set(clubProfileKey(NFT), { coinHolders: { on: false, min: "100", at: nowMs - 500 } });
    const view = await listMembers(store, paired, [], "new", Math.floor(nowMs / 1000), { now: () => nowMs, holdings: byToken });
    assert.equal(view.holders, 0, "a fresh badge is re-read once the rule changes");
  });

  it("keeps one membership, under the Club's own asset", async () => {
    const store = memoryStore();
    await joinClub(store, paired, "u1", [W1], { holdings: holdings({}).fn });
    assert.deepEqual(await store.members(membersKey(NFT)), ["u1"]);
    assert.deepEqual(await store.members(membersKey(COIN)), []);
  });
});

describe("joinClub / leaveClub", () => {
  it("joins with the user's wallets and Holder status, and indexes the membership both ways", async () => {
    const store = memoryStore();
    const h = holdings({ [W2]: 1n });
    const r = await joinClub(store, club, "u1", [getAddress(W1), getAddress(W2)], { holdings: h.fn, now: () => 5_000 });
    assert.ok(r.ok);
    assert.deepEqual(r.row, { userId: "u1", wallets: [W1, W2], displayWallet: W1, holder: true, holderCheckedAt: 5_000, joinedAt: 5_000 });
    assert.deepEqual(await store.members(membersKey(NFT)), ["u1"]);
    assert.deepEqual(await clubsOf(store, "u1"), [NFT.toLowerCase()]);
    assert.deepEqual(await getMember(store, NFT, "u1"), r.row);
    assert.deepEqual(h.calls[0], { token: club.address, wallets: [W1, W2] }, "one read for all wallets");
  });

  it("is idempotent: joining again keeps the join date and doesn't re-read a fresh balance", async () => {
    const store = memoryStore();
    const h = holdings({ [W1]: 1n });
    await joinClub(store, club, "u1", [W1], { holdings: h.fn, now: () => 1_000 });
    const again = await joinClub(store, club, "u1", [W1], { holdings: h.fn, now: () => 9_000 });
    assert.ok(again.ok);
    assert.equal(again.row.joinedAt, 1_000);
    assert.equal(h.calls.length, 1);
    assert.equal(await store.countMembers(membersKey(NFT)), 1);
  });

  it("leaves holder false and the check pending when the chain can't be read", async () => {
    const store = memoryStore();
    const r = await joinClub(store, club, "u1", [W1], { holdings: broken, now: () => 5_000 });
    assert.ok(r.ok);
    assert.equal(r.row.holder, false);
    assert.equal(r.row.holderCheckedAt, 0);
  });

  it("refuses an archived Club, a user with no wallet, and a full Club", async () => {
    const store = memoryStore();
    const deps = { holdings: holdings({}).fn };
    assert.deepEqual(await joinClub(store, archived, "u1", [W1], deps), { ok: false, reason: "archived" });
    assert.deepEqual(await joinClub(store, club, "u1", [], deps), { ok: false, reason: "no_wallet" });
    assert.equal(await store.countMembers(userClubsKeyFor("u1")), 0, "a refused join records nothing");
    for (let i = 0; i < MAX_MEMBERS; i++) await store.addMember(membersKey(NFT), `x${i}`);
    assert.deepEqual(await joinClub(store, club, "u1", [W1], deps), { ok: false, reason: "full" });
    // Someone already in can still re-join (re-sync) when it is full.
    await store.addMember(membersKey(NFT), "u2");
    await store.set(memberKey(NFT, "u2"), {
      userId: "u2",
      wallets: [W2],
      displayWallet: W2,
      holder: false,
      holderCheckedAt: 1,
      joinedAt: 1,
    } satisfies MemberRow);
    assert.ok((await joinClub(store, club, "u2", [W2], deps)).ok);
  });

  it("shows a wallet with a shared profile, not just the first", async () => {
    const store = memoryStore();
    await store.set(profileKey(W2), { provider: "twitter", handle: "chog", userId: "u1", updatedAt: 1 });
    await store.setMembers(userWalletsKey("u1"), [W2]);
    const r = await joinClub(store, club, "u1", [W1, W2], { holdings: holdings({}).fn });
    assert.ok(r.ok);
    assert.equal(r.row.displayWallet, W2);
  });

  it("leaves cleanly, and leaving twice is harmless", async () => {
    const store = memoryStore();
    await joinClub(store, club, "u1", [W1], { holdings: holdings({}).fn });
    await joinClub(store, pets, "u1", [W1], { holdings: holdings({}).fn });
    await leaveClub(store, NFT, "u1");
    await leaveClub(store, NFT, "u1");
    assert.equal(await getMember(store, NFT, "u1"), null);
    assert.deepEqual(await store.members(membersKey(NFT)), []);
    assert.deepEqual(await clubsOf(store, "u1"), [PETS.toLowerCase()], "other Clubs are untouched");
  });
});
const userClubsKeyFor = (id: string) => `declub:user-clubs:${id}`;

describe("syncMemberships", () => {
  const join = async (store = memoryStore()) => {
    await joinClub(store, club, "u1", [W1], { holdings: holdings({ [W1]: 1n }).fn, now: () => 5_000 });
    await joinClub(store, pets, "u1", [W1], { holdings: holdings({}).fn, now: () => 5_000 });
    return store;
  };

  it("updates the wallets in every Club and forces a re-check", async () => {
    const store = await join();
    await syncMemberships(store, "u1", [W2]);
    for (const token of [NFT, PETS]) {
      const row = await getMember(store, token, "u1");
      assert.deepEqual(row?.wallets, [W2]);
      assert.equal(row?.displayWallet, W2);
      assert.equal(row?.holderCheckedAt, 0);
    }
  });

  it("leaves a row alone when nothing changed", async () => {
    const store = await join();
    const before = await getMember(store, NFT, "u1");
    await syncMemberships(store, "u1", [W1]);
    assert.deepEqual(await getMember(store, NFT, "u1"), before);
  });

  it("removes a user left with no wallet from every Club", async () => {
    const store = await join();
    await syncMemberships(store, "u1", []);
    assert.deepEqual(await clubsOf(store, "u1"), []);
    assert.deepEqual(await store.members(membersKey(NFT)), []);
    assert.equal(await getMember(store, PETS, "u1"), null);
  });

  it("does nothing for someone in no Club", async () => {
    const store = memoryStore();
    await syncMemberships(store, "nobody", [W1]);
    assert.deepEqual(await store.members(userClubsKeyFor("nobody")), []);
  });

  it("follows a Privy webhook: an unlinked wallet stops counting, a deleted user leaves", async () => {
    const store = await join();
    const account = (address: string) => ({ type: "wallet", chain_type: "ethereum", address });
    await handlePrivyEvent({ type: "user.unlinked_account", user: { id: "u1" } }, store, async () => [account(W2)]);
    assert.deepEqual((await getMember(store, NFT, "u1"))?.wallets, [W2]);
    await handlePrivyEvent({ type: "user.deleted", user: { id: "u1" } }, store, async () => null);
    assert.deepEqual(await clubsOf(store, "u1"), []);
  });
});

describe("listMembers", () => {
  const nowMs = 100 * HOLDER_RECHECK_MS;
  const nowSec = Math.floor(nowMs / 1000);
  const swap = (parties: string[]): ActivityEvent => ({
    id: "s",
    kind: "swapped",
    contract: "0xc",
    deal: "s",
    block: 1,
    at: nowSec - 60,
    parties,
    tokens: [NFT.toLowerCase()],
  });
  const seed = async (store = memoryStore()) => {
    const row = (id: string, w: string, over: Partial<MemberRow> = {}): MemberRow => ({
      userId: id,
      wallets: [w],
      displayWallet: w,
      holder: false,
      holderCheckedAt: nowMs,
      joinedAt: 1,
      ...over,
    });
    for (const r of [row("u1", W1), row("u2", W2, { joinedAt: 2 })]) {
      await store.addMember(membersKey(NFT), r.userId);
      await store.set(memberKey(NFT, r.userId), r);
    }
    return store;
  };

  it("ranks members by their wallets' Momentum", async () => {
    const store = await seed();
    const view = await listMembers(store, club, [swap([W2, "0x00000000000000000000000000000000000000c3"])], "momentum", nowSec, {
      now: () => nowMs,
      holdings: holdings({}).fn,
    });
    assert.deepEqual(
      view.members.map((m) => m.wallet),
      [W2, W1],
    );
    assert.equal(view.members[0]!.swaps, 1);
    assert.ok(view.members[0]!.momentum > 0);
    assert.equal(view.members[1]!.momentum, 0);
  });

  it("re-reads balances older than a day and saves the new badge", async () => {
    const store = await seed();
    await store.set(memberKey(NFT, "u1"), {
      userId: "u1",
      wallets: [W1],
      displayWallet: W1,
      holder: false,
      holderCheckedAt: nowMs - HOLDER_RECHECK_MS - 1,
      joinedAt: 1,
    });
    const h = holdings({ [W1]: 3n });
    const view = await listMembers(store, club, [], "new", nowSec, { now: () => nowMs, holdings: h.fn });
    assert.equal(h.calls.length, 1, "only the stale row is read");
    assert.equal(view.holders, 1);
    assert.deepEqual(await getMember(store, NFT, "u1").then((r) => [r?.holder, r?.holderCheckedAt]), [true, nowMs]);
    // Read again: now fresh, nothing more to read.
    await listMembers(store, club, [], "new", nowSec, { now: () => nowMs, holdings: h.fn });
    assert.equal(h.calls.length, 1);
  });

  it("keeps the old badge, and tries again next time, when the chain can't be read", async () => {
    const store = await seed();
    const old: MemberRow = { userId: "u1", wallets: [W1], displayWallet: W1, holder: true, holderCheckedAt: 0, joinedAt: 1 };
    await store.set(memberKey(NFT, "u1"), old);
    const view = await listMembers(store, club, [], "new", nowSec, { now: () => nowMs, holdings: broken });
    assert.equal(view.holders, 1);
    assert.deepEqual(await getMember(store, NFT, "u1"), old);
  });

  it("limits the re-checks one read makes", async () => {
    const store = memoryStore();
    for (let i = 0; i < RECHECK_PER_READ + 5; i++) {
      const row: MemberRow = { userId: `u${i}`, wallets: [W1], displayWallet: W1, holder: false, holderCheckedAt: 0, joinedAt: i };
      await store.addMember(membersKey(NFT), row.userId);
      await store.set(memberKey(NFT, row.userId), row);
    }
    const h = holdings({});
    await listMembers(store, club, [], "new", nowSec, { now: () => nowMs, holdings: h.fn });
    assert.equal(h.calls.length, RECHECK_PER_READ);
  });

  it("skips an id whose row is gone, and counts holders from rows", async () => {
    const store = await seed();
    await store.addMember(membersKey(NFT), "ghost");
    const view = await listMembers(store, club, [], "new", nowSec, { now: () => nowMs, holdings: holdings({}).fn });
    assert.equal(view.total, 2);
    assert.equal(await holderCount(store, NFT), 0);
  });
});

describe("the routes", () => {
  const store = getStore()!;
  const account = (address: string) => ({ type: "wallet", chain_type: "ethereum", address });
  const gateAs = (id: string, accounts: ReturnType<typeof account>[]) => async (): Promise<UserGate> =>
    ({ store, user: { id, linked_accounts: accounts } }) as unknown as UserGate;
  const signedOut = async (): Promise<UserGate> => Response.json({ error: "unauthorized" }, { status: 401 });
  const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
  const req = (method = "GET", url = "http://x/api") => new Request(url, { method, headers: { "x-forwarded-for": "203.0.113.7" } });
  const h = holdings({ [W1]: 1n });

  it("joins, reports the membership, and leaves", async () => {
    const m = membershipHandlers(reg, { gate: gateAs("route-u1", [account(getAddress(W1))]), holdings: h.fn });
    assert.deepEqual(await (await m.GET(req(), ctx(NFT))).json(), { enabled: true, member: false });

    const joined = await m.POST(req("POST"), ctx(NFT.toLowerCase()));
    assert.equal(joined.status, 200);
    const body = await joined.json();
    assert.deepEqual({ ...body, joinedAt: 0 }, { enabled: true, member: true, wallet: W1, holder: true, joinedAt: 0, role: "member" });
    assert.ok(!JSON.stringify(body).includes("route-u1"), "no user id in the answer");
    assert.equal((await (await m.GET(req(), ctx(NFT))).json()).member, true);

    assert.deepEqual(await (await m.DELETE(req("DELETE"), ctx(NFT))).json(), { enabled: true, member: false });
    assert.equal((await (await m.GET(req(), ctx(NFT))).json()).member, false);
  });

  it("a GET re-syncs wallets: one unlinked elsewhere stops counting", async () => {
    const first = membershipHandlers(reg, { gate: gateAs("route-u2", [account(getAddress(W1))]), holdings: h.fn });
    await first.POST(req("POST"), ctx(NFT));
    const later = membershipHandlers(reg, { gate: gateAs("route-u2", [account(getAddress(W2))]), holdings: h.fn });
    await later.GET(req(), ctx(NFT));
    assert.deepEqual((await getMember(store, NFT, "route-u2"))?.wallets, [W2]);
  });

  it("a GET reads a non-Holder's wallets again after a minute, so an NFT just swapped for counts", async () => {
    const t0 = Date.now();
    const none = holdings({});
    const first = membershipHandlers(reg, { gate: gateAs("route-u4", [account(getAddress(W2))]), holdings: none.fn, now: () => t0 });
    assert.equal((await (await first.POST(req("POST"), ctx(NFT))).json()).holder, false);
    const bought = holdings({ [W2]: 1n });
    const soon = membershipHandlers(reg, { gate: gateAs("route-u4", [account(getAddress(W2))]), holdings: bought.fn, now: () => t0 + 30_000 });
    assert.equal((await (await soon.GET(req(), ctx(NFT))).json()).holder, false);
    assert.equal(bought.calls.length, 0, "not read again within a minute");
    const later = membershipHandlers(reg, { gate: gateAs("route-u4", [account(getAddress(W2))]), holdings: bought.fn, now: () => t0 + 61_000 });
    assert.equal((await (await later.GET(req(), ctx(NFT))).json()).holder, true);
    assert.equal((await getMember(store, NFT, "route-u4"))?.holder, true);
  });

  it("answers 401 signed out, 404 / 400 for no Club, 422 without a wallet, 409 archived", async () => {
    const out = membershipHandlers(reg, { gate: signedOut });
    assert.equal((await out.POST(req("POST"), ctx(NFT))).status, 401);
    const m = membershipHandlers(reg, { gate: gateAs("route-u3", []), holdings: h.fn });
    assert.equal((await m.POST(req("POST"), ctx(NFT))).status, 422);
    assert.equal((await m.POST(req("POST"), ctx("0x00000000000000000000000000000000000000f1"))).status, 404);
    assert.equal((await m.POST(req("POST"), ctx("nope"))).status, 400);
    const withWallet = membershipHandlers(reg, { gate: gateAs("route-u3", [account(getAddress(W1))]), holdings: h.fn });
    const res = await withWallet.POST(req("POST"), ctx(OLD));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "archived");
  });

  it("lists the caller's Clubs, leaving out ones that no longer exist", async () => {
    const m = membershipHandlers(reg, { gate: gateAs("route-u4", [account(getAddress(W1))]), holdings: h.fn });
    await m.POST(req("POST"), ctx(PETS));
    await m.POST(req("POST"), ctx(NFT));
    await store.addMember(userClubsKeyFor("route-u4"), "0x00000000000000000000000000000000000000f1");
    await store.addMember(userClubsKeyFor("route-u4"), NOCLUB.toLowerCase());
    const body = await (await myClubsHandler(reg, { gate: gateAs("route-u4", []) })(req())).json();
    assert.deepEqual(body.clubs, [NFT.toLowerCase(), PETS.toLowerCase()].sort());
  });

  it("serves the leaderboard publicly, validating sort and the Club", async () => {
    const m = membershipHandlers(reg, { gate: gateAs("route-u5", [account(getAddress(W2))]), holdings: h.fn });
    await m.POST(req("POST"), ctx(NFT));
    await store.rank(
      activityKey(NFT),
      [
        {
          member: JSON.stringify({
            id: "r:0",
            kind: "swapped",
            contract: "0xc",
            deal: "1",
            block: 1,
            at: Math.floor(Date.now() / 1000) - 60,
            parties: [W2, "0x00000000000000000000000000000000000000c3"],
            tokens: [NFT.toLowerCase()],
          }),
          score: Math.floor(Date.now() / 1000) - 60,
        },
      ],
      10,
    );
    const get = membersHandler(reg, { settlements: async () => [] });
    const res = await get(req("GET", "http://x/api?sort=momentum"), ctx(NFT));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage/);
    const body = await res.json();
    assert.ok(body.total >= 1);
    const me = body.members.find((x: { wallet: string }) => x.wallet === W2);
    assert.ok(me.momentum > 0 && me.swaps === 1);
    assert.ok(!JSON.stringify(body).includes("route-u"), "no user ids");
    assert.equal((await get(req("GET", "http://x/api?sort=bogus"), ctx(NFT))).status, 400);
    assert.equal((await get(req("GET", "http://x/api?page=0"), ctx(NFT))).status, 400);
    assert.equal((await get(req("GET", "http://x/api?size=101"), ctx(NFT))).status, 400);
    assert.equal((await get(req("GET", `http://x/api?q=${"a".repeat(65)}`), ctx(NFT))).status, 400);
    const found = await (await get(req("GET", `http://x/api?q=${W2.slice(0, 10)}`), ctx(NFT))).json();
    assert.ok(found.matches >= 1 && found.matches <= found.total);
    assert.equal((await get(req(), ctx("0x00000000000000000000000000000000000000f1"))).status, 404);
  });
});
