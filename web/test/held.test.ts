import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { DEFAULT_CLUB_RULES, backingPoints, type Voice } from "../lib/rewards";
import { backingRecordKey, type PublishedBacking } from "../lib/server/backing";
import { createPost, likePost, type Deps } from "../lib/server/board";
import { heldKey, readHeld, sampleHoldings } from "../lib/server/held";
import { joinClub, type Holdings } from "../lib/server/members";
import { buildEpoch, holderInputs } from "../lib/server/rewards";
import { verifiedBy } from "../lib/server/rewards";
import { epochBackingHandler } from "../lib/server/rewardRoutes";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const reg = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "N", symbol: "N", status: "verified", note: "Why." }]));
const club = reg.clubFor(NFT)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const GENESIS = 1_700_000_000;
const DAY = 86_400;
const WEEK = 7 * DAY;
const at = (s: number): Deps => ({ now: () => (GENESIS + s) * 1000, epochs: { genesis: GENESIS, length: WEEK } });
const epochs = { genesis: GENESIS, length: WEEK };

/** A member with a shared verified profile, joined. */
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

/** What each wallet holds: change it between samples. */
function chain(table: Record<string, bigint>): Holdings {
  return async (_token, wallets) => wallets.map((w) => table[w.toLowerCase()] ?? 0n);
}

describe("holdings sampling (ADR 0040)", () => {
  it("samples once per UTC day per Club, and skips a day already sampled", async () => {
    const store = memoryStore();
    await member(store, "g", 1);
    const table: Record<string, bigint> = { [wallet(1)]: 3n };
    let reads = 0;
    const holdings: Holdings = async (t, ws) => (reads++, chain(table)(t, ws));
    const now = GENESIS + 60;
    assert.deepEqual(await sampleHoldings(store, [club], holdings, now, epochs), { sampled: [token], skipped: [], failed: [] });
    assert.deepEqual(await sampleHoldings(store, [club], holdings, now + 600, epochs), { sampled: [], skipped: [token], failed: [] }, "the second call the same day skips");
    assert.equal(reads, 1);
    await sampleHoldings(store, [club], holdings, now + DAY, epochs);
    assert.deepEqual(await readHeld(store, token, 0), { days: [Math.floor(now / DAY), Math.floor(now / DAY) + 1], sums: { g: "6" } });
    assert.deepEqual(await sampleHoldings(store, [club], holdings, GENESIS - 10, epochs), { sampled: [], skipped: [], failed: [] }, "nothing before genesis");
  });

  it("leaves a Club for the next run when its balances can't be read", async () => {
    const store = memoryStore();
    await member(store, "g", 1);
    const result = await sampleHoldings(store, [club], async () => null, GENESIS + 60, epochs);
    assert.deepEqual(result.failed, [token]);
    assert.equal(await store.get(heldKey(token, 0)), null);
    assert.equal((await sampleHoldings(store, [club], chain({ [wallet(1)]: 1n }), GENESIS + 120, epochs)).sampled.length, 1, "retried, and the failure left no lock behind");
  });

  it("gives about 1/8 of the voice and the weight for NFTs bought on the last day", async () => {
    const store = memoryStore();
    for (const [u, n] of [["g", 1], ["h", 2], ["s", 3], ["a", 4], ["b", 5], ["c", 6]] as const) await member(store, u, n);
    const table: Record<string, bigint> = { [wallet(1)]: 5n, [wallet(3)]: 5n, [wallet(4)]: 1n, [wallet(5)]: 1n, [wallet(6)]: 1n };
    // g held 5 all week; s held 5 all week and sold before close; h held nothing until close.
    for (let d = 0; d < 7; d++) await sampleHoldings(store, [club], chain(table), GENESIS + d * DAY, epochs);
    table[wallet(2)] = 5n;
    table[wallet(3)] = 0n;

    const pa = await post(store, "a", 60);
    const pb = await post(store, "b", 60);
    const pc = await post(store, "c", 60);
    await likePost(store, club, "g", pa, true, at(120));
    await likePost(store, club, "h", pb, true, at(120));
    await likePost(store, club, "s", pc, true, at(120));

    const { holders, samples } = await holderInputs(store, club, 0, [], null, chain(table), {}, verifiedBy(GENESIS + WEEK));
    assert.equal(samples, 7);
    const by = Object.fromEntries(holders.map((h) => [h.userId, h]));
    // Voices count the average over 8 reads: g 5, h 5/8, s 35/8 (sold at close, so sampled, so it still speaks).
    assert.equal(by.a!.backedPoints, 50 + 3, "g's whole voice, and a base voice");
    assert.equal(by.b!.backedPoints, 6.25 + 3, "h's voice is an eighth of g's");
    assert.equal(by.c!.backedPoints, 43.75 + 3, "s keeps the voice of the NFTs held during the week");
    assert.equal(by.s, undefined, "but s holds nothing at close, so isn't a Holder to be paid");
    assert.equal(by.g!.held, 40n, "seven samples of 5, and the close");
    assert.equal(by.h!.held, 5n, "only the close");
    assert.equal(by.g!.shares, 5n);
  });

  it("matches today's behaviour with no samples", async () => {
    const store = memoryStore();
    for (const [u, n] of [["g", 1], ["a", 2]] as const) await member(store, u, n);
    const p = await post(store, "a", 60);
    await likePost(store, club, "g", p, true, at(120));
    const { holders, samples } = await holderInputs(store, club, 0, [], null, chain({ [wallet(1)]: 5n, [wallet(2)]: 1n }), {}, verifiedBy(GENESIS + WEEK));
    assert.equal(samples, 0);
    assert.equal(holders.find((h) => h.userId === "g")!.held, 5n, "the average is the holding");
    assert.equal(holders.find((h) => h.userId === "a")!.backedPoints, 50 + 3);
  });
});

describe("the published backing (ADR 0040)", () => {
  it("gives the rules and samples with the epoch, and backing that recomputes to the published points", async () => {
    const store = memoryStore();
    for (const [u, n] of [["g", 1], ["a", 2], ["mod", 3], ["x", 4]] as const) await member(store, u, n);
    const table: Record<string, bigint> = { [wallet(1)]: 4n, [wallet(2)]: 2n };
    for (let d = 0; d < 3; d++) await sampleHoldings(store, [club], chain(table), GENESIS + d * DAY, epochs);
    const pa = await post(store, "a", 60);
    const pg = await post(store, "g", 60);
    const px = await post(store, "x", 60);
    await likePost(store, club, "g", pa, true, at(120));
    await likePost(store, club, "a", pg, true, at(130));
    await likePost(store, club, "g", px, true, at(140));
    // A moderator hid x's post: g's like on it is removed, and published as such.
    await store.set(`declub:club-post:10143:${token}:${px}`, { ...(await store.get<object>(`declub:club-post:10143:${token}:${px}`))!, hidden: "moderator" });

    const swap = { id: "0x1:0", kind: "swapped" as const, contract: "0xswap", deal: "1", block: 1, at: GENESIS + 100, parties: [wallet(1), wallet(9)], tokens: [token], fee: (4n * 10n ** 18n).toString() };
    const rules = { ...DEFAULT_CLUB_RULES, minPoints: 1 };
    const result = await buildEpoch(store, 0, {
      now: () => GENESIS + WEEK,
      clubs: [club],
      events: async () => [swap],
      holdings: chain(table),
      chainId: 10143,
      contract: getAddress(wallet(0xee)),
      genesis: GENESIS,
      length: WEEK,
      rules: () => rules,
    });
    assert.equal(result.status, "built");
    const record = result.status === "built" ? result.record : undefined!;
    assert.deepEqual(record.clubs[0]!.rules, rules, "the rules used are published with the epoch");
    assert.equal(record.clubs[0]!.samples, 3);

    const published = (await store.get<Record<string, PublishedBacking>>(backingRecordKey(0)))![token]!;
    assert.deepEqual(published.removed, [{ from: wallet(1), to: wallet(4), kind: "like", by: "moderator" }]);
    assert.equal(published.actions.length, 2);

    // Anyone can recompute each Holder's backed points from what is published: and they match the leaves.
    const voices = new Map<string, Voice>(Object.entries(published.voices));
    const recomputed = backingPoints(published.actions.map((a) => ({ giver: a.from, receiver: a.to, kind: a.kind })), voices, record.clubs[0]!.rules);
    for (const leaf of record.leaves) {
      const holder = leaf.breakdown.find((b) => b.kind === "holder");
      if (holder) assert.equal(holder.backed, recomputed.get(leaf.account.toLowerCase())!.points, `${leaf.account}`);
    }
    assert.ok(record.leaves.length > 0 && record.leaves.some((l) => l.breakdown.some((b) => b.held !== undefined)), "payouts publish the average NFTs");

    const GET = epochBackingHandler({ store: () => store });
    const res = await GET(new Request("http://x/api"), { params: Promise.resolve({ n: "0" }) });
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { clubs: Record<string, PublishedBacking> }).clubs[token], published);
    assert.equal((await GET(new Request("http://x/api"), { params: Promise.resolve({ n: "5" }) })).status, 404);
  });
});
