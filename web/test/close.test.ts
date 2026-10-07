import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { DEFAULT_CLUB_RULES } from "../lib/rewards";
import { createPost, likePost, postKey, type Deps } from "../lib/server/board";
import { joinClub, type Holdings } from "../lib/server/members";
import { buildEpoch, closeEpoch, closingKey, pointsKey, readEpoch, type PublishedLedger, type RewardsDeps } from "../lib/server/rewards";
import { epochPointsHandler } from "../lib/server/rewardRoutes";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const reg = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." }]));
const club = reg.clubFor(NFT)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const GENESIS = 1_700_000_000;
const WEEK = 7 * 86_400;
const at = (s: number): Deps => ({ now: () => (GENESIS + s) * 1000, epochs: { genesis: GENESIS, length: WEEK } });
const held: Record<string, bigint> = { [wallet(1)]: 4n, [wallet(2)]: 2n, [wallet(3)]: 1n };
const holdings: Holdings = async (_t, ws) => ws.map((w) => held[w.toLowerCase()] ?? 0n);

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

/** g (4 NFTs) and a (2) like each other's posts; q (1) does nothing. */
async function world() {
  const store = memoryStore();
  for (const [u, n] of [["g", 1], ["a", 2], ["q", 3]] as const) await member(store, u, n);
  const pg = await post(store, "g", 60);
  const pa = await post(store, "a", 60);
  assert.ok((await likePost(store, club, "g", pa, true, at(120))).ok);
  assert.ok((await likePost(store, club, "a", pg, true, at(130))).ok);
  return { store, pg, pa };
}

const deps = (over: Partial<RewardsDeps> = {}): RewardsDeps => ({
  now: () => GENESIS + WEEK + 3_600,
  clubs: [club],
  events: async () => [],
  holdings,
  chainId: 10143,
  contract: getAddress(wallet(0xee)),
  genesis: GENESIS,
  length: WEEK,
  // Whole voices: these tests are about the freeze, not the pair cap (ADR 0044).
  rules: () => ({ ...DEFAULT_CLUB_RULES, pairCap: 60 }),
  ...over,
});
const ledgerOf = async (store: Store) => (await store.get<Record<string, PublishedLedger>>(pointsKey(0)))![token]!;
const row = (l: PublishedLedger, n: number) => l.rows.find((r) => r.wallet === wallet(n))!;

describe("closing an epoch (ADR 0040)", () => {
  it("waits for the epoch to end, closes each Club once, and leaves a Club it can't read for the next run", async () => {
    const { store } = await world();
    assert.deepEqual(await closeEpoch(store, 0, deps({ now: () => GENESIS + WEEK - 1 })), { status: "open", endsAt: GENESIS + WEEK });
    assert.deepEqual(await closeEpoch(store, 0, deps({ holdings: async () => null })), { status: "closed", closed: [], existing: [], failed: [token] });
    assert.equal(await store.get(closingKey(token, 0)), null, "nothing stored for a Club that couldn't be read");
    assert.deepEqual(await closeEpoch(store, 0, deps()), { status: "closed", closed: [token], existing: [], failed: [] });
    assert.deepEqual(await closeEpoch(store, 0, deps({ holdings: async () => { throw new Error("must not read again"); } })), { status: "closed", closed: [], existing: [token], failed: [] });
  });

  it("freezes the epoch's backing: a like taken back, or a moderator's hide, after the close changes nothing", async () => {
    const { store, pg, pa } = await world();
    await closeEpoch(store, 0, deps());
    // After the close: g takes the like back, and a moderator hides g's post.
    assert.ok((await likePost(store, club, "g", pa, false, at(WEEK + 10))).ok);
    await store.set(postKey(token, pg), { ...(await store.get<object>(postKey(token, pg)))!, hidden: "moderator" });

    const built = await buildEpoch(store, 0, deps({ now: () => GENESIS + WEEK + 7_200 }));
    assert.equal(built.status, "built");
    const ledger = await ledgerOf(store);
    // g's voice is 40 (4 NFTs) and a's 20, both halved because they backed each other, plus half a base voice each.
    assert.equal(row(ledger, 2).backedPoints, 21.5, "a keeps what g's like gave");
    assert.equal(row(ledger, 1).backedPoints, 11.5, "and g what a's like gave");

    // The same changes before the close do count: this is what the freeze protects from.
    const control = await world();
    assert.ok((await likePost(control.store, club, "g", control.pa, false, at(300))).ok);
    await buildEpoch(control.store, 0, deps());
    const after = await ledgerOf(control.store);
    assert.equal(row(after, 2).backedPoints, 0);
    assert.equal(row(after, 1).backedPoints, 23, "no mutual halving once g's like is gone");
  });

  it("closes at build time when the close job didn't run, and publishes when the inputs were frozen", async () => {
    const { store } = await world();
    const built = await buildEpoch(store, 0, deps());
    const record = built.status === "built" ? built.record : undefined!;
    assert.equal(record.clubs[0]!.closedAt, GENESIS + WEEK + 3_600);
    assert.ok(await store.get(closingKey(token, 0)));

    const { store: early } = await world();
    await closeEpoch(early, 0, deps({ now: () => GENESIS + WEEK + 300 }));
    const later = await buildEpoch(early, 0, deps({ now: () => GENESIS + WEEK + 90_000 }));
    assert.equal(later.status === "built" && later.record.clubs[0]!.closedAt, GENESIS + WEEK + 300, "the freeze time is the close's, not the build's");
  });

  it("publishes every Holder's final points, paid or not, and serves them", async () => {
    const { store } = await world();
    await buildEpoch(store, 0, { ...deps(), events: async () => [] });
    const ledger = await ledgerOf(store);
    assert.deepEqual(ledger.rules, { ...DEFAULT_CLUB_RULES, pairCap: 60 });
    assert.deepEqual(ledger.rows.map((r) => [r.wallet, r.holder, r.paid]), [[wallet(2), true, true], [wallet(1), true, true], [wallet(3), true, false]], "ranked by points; the idle Holder is listed, unpaid");
    const q = row(ledger, 3);
    assert.deepEqual([q.points, q.days, q.bonusBps, q.shares, q.held], [0, 0, 0, "1", 1]);
    assert.ok(!JSON.stringify(ledger).includes("did:") && !JSON.stringify(ledger).includes('"g"'), "no user ids");
    const record = (await readEpoch(store, 0))!;
    for (const leaf of record.leaves) {
      const holder = leaf.breakdown.find((b) => b.kind === "holder");
      if (holder) assert.equal(holder.points, ledger.rows.find((r) => r.wallet === leaf.account.toLowerCase())!.points);
    }

    const GET = epochPointsHandler({ store: () => store });
    const res = await GET(new Request("http://x/api"), { params: Promise.resolve({ n: "0" }) });
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { clubs: Record<string, PublishedLedger> }).clubs[token], ledger);
    assert.equal((await GET(new Request("http://x/api"), { params: Promise.resolve({ n: "3" }) })).status, 404);
  });
});
