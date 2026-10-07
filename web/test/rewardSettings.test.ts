import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import type { ActivityEvent } from "../lib/clubs";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { DEFAULT_CLUB_RULES, type ClubRules } from "../lib/rewards";
import type { PublishedBacking } from "../lib/server/backing";
import { createPost, likePost, type Deps } from "../lib/server/board";
import { rewardBansHandlers, rulesHandlers } from "../lib/server/boardRoutes";
import { rulesFor } from "../lib/server/clubRules";
import { readLog, saveRoles } from "../lib/server/clubState";
import { joinClub, type Holdings } from "../lib/server/members";
import { backingRecordKey } from "../lib/server/backing";
import { buildEpoch, closeEpoch, pointsKey, type PublishedLedger, type RewardsDeps } from "../lib/server/rewards";
import { listRewardBans, setRewardBan, updateRules } from "../lib/server/rewardSettings";
import type { UserGate } from "../lib/server/gate";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const reg = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." }]));
const club = reg.clubFor(NFT)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const GENESIS = 1_700_000_000;
const WEEK = 7 * 86_400;
/** The Board's clock `s` seconds into epoch 0, and the admins. */
const at = (s: number): Deps => ({ now: () => (GENESIS + s) * 1000, epochs: { genesis: GENESIS, length: WEEK }, admins: new Set(["adm"]) });
const actor = (userId: string, n: number) => ({ userId, wallet: wallet(n) });

async function member(store: Store, userId: string, n: number) {
  const w = wallet(n);
  await store.set(profileKey(w), { provider: "twitter", handle: `h${n}`, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [w]);
  assert.ok((await joinClub(store, club, userId, [w], { holdings: async () => [0n] })).ok);
}
async function post(store: Store, userId: string, s: number) {
  await store.del(`declub:rl:club-post-cd:${token}:${userId}`, `declub:rl:club-post-hr:${token}:${userId}`);
  const r = await createPost(store, club, userId, { kind: "note", text: "gm" }, at(s));
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
const held: Record<string, bigint> = { [wallet(1)]: 1n, [wallet(3)]: 4n, [wallet(4)]: 2n };
const holdings: Holdings = async (_t, ws) => ws.map((w) => held[w.toLowerCase()] ?? 0n);
const swap: ActivityEvent = { id: "0x1:0", kind: "swapped", contract: "0xswap", deal: "1", block: 1, at: GENESIS + 100, parties: [wallet(8), wallet(9)], tokens: [token], fee: (4n * 10n ** 18n).toString() };
const deps = (n: number, over: Partial<RewardsDeps> = {}): RewardsDeps => ({
  now: () => GENESIS + (n + 1) * WEEK + 60,
  clubs: [club],
  events: async () => [{ ...swap, at: GENESIS + n * WEEK + 100 }],
  holdings,
  chainId: 10143,
  contract: getAddress(wallet(0xee)),
  genesis: GENESIS,
  length: WEEK,
  ...over,
});

describe("an Owner's reward rules (ADR 0044)", () => {
  it("are the Owner's to change, within bounds, and apply from the next epoch", async () => {
    const store = await world();
    assert.deepEqual(await updateRules(store, club, actor("mod", 2), { maxPaid: 3 }, at(60)), { ok: false, reason: "forbidden" }, "not a Moderator");
    assert.deepEqual(await updateRules(store, club, actor("a", 4), { maxPaid: 3 }, at(60)), { ok: false, reason: "forbidden" });
    const bad = await updateRules(store, club, actor("own", 1), { nonHolderBps: 9_000 }, at(60));
    assert.equal(bad.ok || bad.reason, "invalid");
    const points = await updateRules(store, club, actor("own", 1), { voicePerNft: 50 }, at(60));
    assert.equal(points.ok || points.reason, "invalid", "how points count isn't the Owner's");

    const saved = await updateRules(store, club, actor("own", 1), { maxPaid: 3, nonHolderBps: 1_000 }, at(60));
    assert.ok(saved.ok);
    assert.deepEqual(saved.view.current, DEFAULT_CLUB_RULES, "this epoch keeps its rules");
    assert.deepEqual(saved.view.next, { from: 1, rules: { ...DEFAULT_CLUB_RULES, maxPaid: 3, nonHolderBps: 1_000 } });
    assert.deepEqual(await rulesFor(store, token, 0), DEFAULT_CLUB_RULES);
    assert.equal((await rulesFor(store, token, 1)).maxPaid, 3);
    assert.equal((await rulesFor(store, token, 9)).maxPaid, 3, "and every epoch after, until changed");

    // A second change in the same epoch builds on the first and replaces it.
    const again = await updateRules(store, club, actor("adm", 99), { rampPoints: 8 }, at(120));
    assert.ok(again.ok);
    assert.deepEqual(again.view.next?.rules, { ...DEFAULT_CLUB_RULES, maxPaid: 3, nonHolderBps: 1_000, rampPoints: 8 });
    const log = await readLog(store, token);
    assert.equal(log[0]!.action, "edit_rules");
    assert.match(log[0]!.detail ?? "", /from epoch 1: rampPoints 5 → 8/);

    // A change in epoch 1 waits for epoch 2; epoch 1 keeps what was saved for it.
    assert.ok((await updateRules(store, club, actor("own", 1), { maxPaid: 5 }, at(WEEK + 60))).ok);
    assert.equal((await rulesFor(store, token, 1)).maxPaid, 3);
    assert.equal((await rulesFor(store, token, 2)).maxPaid, 5);
  });

  it("are frozen with the epoch and published with it", async () => {
    const store = await world();
    await updateRules(store, club, actor("own", 1), { maxPaid: 1 }, at(60));
    await closeEpoch(store, 0, deps(0));
    const first = await buildEpoch(store, 0, deps(0));
    assert.equal(first.status === "built" && first.record.clubs[0]!.rules?.maxPaid, 0, "epoch 0 is paid under the old rules");
    const second = await buildEpoch(store, 1, deps(1));
    assert.equal(second.status === "built" && second.record.clubs[0]!.rules?.maxPaid, 1);
  });

  it("are served publicly, and changed through the route by the Owner only", async () => {
    const store = await world();
    let who = "own";
    const gate = async (): Promise<UserGate> => ({ store, user: { id: who, linked_accounts: [] } }) as unknown as UserGate;
    const handlers = rulesHandlers(reg, { ...at(60), gate });
    const ctx = { params: Promise.resolve({ token: NFT }) };
    const patch = (body: unknown) => handlers.PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.9" } }), ctx);
    assert.equal((await patch({ maxPaidPercent: 0 })).status, 400);
    const ok = await patch({ maxPaidPercent: 25 });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { next: { rules: ClubRules } }).next.rules.maxPaidPercent, 25);
    who = "a";
    assert.equal((await patch({ maxPaidPercent: 50 })).status, 403);
  });
});

describe("bans from rewards (ADR 0044)", () => {
  it("are the Owner's, by Club wallet, logged, and readable by staff", async () => {
    const store = await world();
    assert.deepEqual(await setRewardBan(store, club, actor("mod", 2), wallet(3), true, at(60)), { ok: false, reason: "forbidden" });
    assert.deepEqual(await setRewardBan(store, club, actor("own", 1), wallet(1), true, at(60)), { ok: false, reason: "invalid" }, "not yourself");
    assert.deepEqual(await setRewardBan(store, club, actor("own", 1), wallet(77), true, at(60)), { ok: false, reason: "not_found" });
    assert.deepEqual(await setRewardBan(store, club, actor("own", 1), "nope", true, at(60)), { ok: false, reason: "invalid" });
    assert.deepEqual(await setRewardBan(store, club, actor("own", 1), getAddress(wallet(3)), true, at(60)), { ok: true, wallet: wallet(3) });
    assert.deepEqual(await setRewardBan(store, club, actor("own", 1), wallet(3), true, at(60)), { ok: false, reason: "no_change" });
    assert.deepEqual((await listRewardBans(store, club, "mod", at(60)))!.map((b) => b.wallet), [wallet(3)]);
    assert.equal(await listRewardBans(store, club, "a", at(60)), null, "members can't read it");
    assert.deepEqual((await readLog(store, token)).map((l) => [l.action, l.target]), [["reward_ban", wallet(3)]]);
    assert.ok((await setRewardBan(store, club, actor("own", 1), wallet(3), false, at(120))).ok);
    assert.deepEqual(await listRewardBans(store, club, "mod", at(60)), []);
  });

  it("leave a banned member unpaid, and their backing worth nothing, and publish it", async () => {
    const store = await world();
    const pa = await post(store, "a", 60);
    assert.ok((await likePost(store, club, "g", pa, true, at(120))).ok);
    assert.ok((await setRewardBan(store, club, actor("own", 1), wallet(3), true, at(300))).ok);
    const built = await buildEpoch(store, 0, deps(0));
    const record = built.status === "built" ? built.record : undefined!;
    assert.deepEqual(record.clubs[0]!.excluded, [wallet(3)]);
    assert.ok(!record.leaves.some((l) => l.account.toLowerCase() === wallet(3)), "g isn't paid");
    const ledger = (await store.get<Record<string, PublishedLedger>>(pointsKey(0)))![token]!;
    assert.equal(ledger.rows.find((r) => r.wallet === wallet(4))!.backedPoints, 0, "g's like gave a nothing");
    assert.ok(!ledger.rows.some((r) => r.wallet === wallet(3)));
    const backing = (await store.get<Record<string, PublishedBacking>>(backingRecordKey(0)))![token]!;
    assert.deepEqual(backing.removed, [{ from: wallet(3), to: wallet(4), kind: "like", by: "reward_ban" }]);
  });

  it("are served to staff and set by the Owner through the route", async () => {
    const store = await world();
    let who = "own";
    const gate = async (): Promise<UserGate> => ({ store, user: { id: who, linked_accounts: [] } }) as unknown as UserGate;
    const handlers = rewardBansHandlers(reg, { ...at(60), gate });
    const ctx = { params: Promise.resolve({ token: NFT }) };
    const req = (method: string, body?: unknown) => new Request("http://x/api", { method, ...(body ? { body: JSON.stringify(body) } : {}), headers: { "x-forwarded-for": "203.0.113.9" } });
    assert.equal((await handlers.POST(req("POST", { wallet: wallet(4) }), ctx)).status, 200);
    who = "mod";
    assert.equal((await handlers.DELETE(req("DELETE", { wallet: wallet(4) }), ctx)).status, 403);
    const list = (await (await handlers.GET(req("GET"), ctx)).json()) as { bans: { wallet: string }[] };
    assert.deepEqual(list.bans.map((b) => b.wallet), [wallet(4)]);
    who = "a";
    assert.equal((await handlers.GET(req("GET"), ctx)).status, 403);
  });
});

describe("paying members without NFTs (ADR 0044)", () => {
  it("pays the Owner's slice to members with points, and lists them in the ledger", async () => {
    const store = await world();
    const pa = await post(store, "a", 60);
    await post(store, "x", 60);
    await post(store, "x", 86_400 + 60);
    assert.ok((await likePost(store, club, "x", pa, true, at(120))).ok);
    const rules = { ...DEFAULT_CLUB_RULES, nonHolderBps: 2_000 };
    const built = await buildEpoch(store, 0, deps(0, { rules: () => rules }));
    const record = built.status === "built" ? built.record : undefined!;
    const line = record.clubs[0]!;
    // 4 MON of fees: a 2 MON Holder pool, of which 20% to members without NFTs.
    assert.equal(line.paidMembers, (4n * 10n ** 17n).toString());
    assert.equal(line.memberCount, 1);
    const x = record.leaves.find((l) => l.account.toLowerCase() === wallet(5))!;
    assert.deepEqual(x.breakdown.map((b) => [b.kind, b.amount]), [["member", (4n * 10n ** 17n).toString()]]);
    const ledger = (await store.get<Record<string, PublishedLedger>>(pointsKey(0)))![token]!;
    const row = ledger.rows.find((r) => r.wallet === wallet(5))!;
    assert.deepEqual([row.holder, row.paid, row.days], [false, true, 2]);

    // Off, x isn't paid and the Holders keep it all.
    const off = await world();
    await post(off, "x", 60);
    const plain = await buildEpoch(off, 0, deps(0));
    assert.ok(plain.status === "built" && !plain.record.leaves.some((l) => l.account.toLowerCase() === wallet(5)));
  });
});
