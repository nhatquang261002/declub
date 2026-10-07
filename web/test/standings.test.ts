import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getAddress, type Address } from "viem";
import type { ActivityEvent } from "../lib/clubs";
import type { MemberRow } from "../lib/members";
import { REWARDS } from "../lib/rewards";
import { recordActive } from "../lib/server/activeDays";
import { postKey } from "../lib/server/board";
import { memberKey, membersKey, type Holdings } from "../lib/server/members";
import { STANDINGS_TTL_SEC, clubStandings, standingsView, type StandingsDeps } from "../lib/server/standings";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets, type ClubEntry } from "../lib/verifiedAssets";

const ETH = 10n ** 18n;
const GENESIS = 1_800_000_000;
const WEEK = 604_800;
const NFT: Address = getAddress("0x220a2c52fd27252e7cd6163a7bf1b6ae159d26e4");
const clubs = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "Mock Chog", symbol: "MCHOG", status: "verified", note: "x" }])).clubs(10143);
const club = clubs[0]!;
const w = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;

async function join(store: Store, userId: string, wallet: string, joinedAt: number) {
  const row: MemberRow = { userId, wallets: [wallet], displayWallet: wallet, holder: true, holderCheckedAt: 1, joinedAt };
  await store.set(memberKey(NFT, userId), row);
  await store.addMember(membersKey(NFT), userId);
}

const swap = (at: number): ActivityEvent => ({ id: `0x${at}:0`, kind: "swapped", contract: "0xswap", deal: "1", block: 1, at, parties: [w(1), w(2)], tokens: [NFT.toLowerCase()], fee: (8n * ETH).toString() });

describe("live standings", () => {
  let store: Store;
  let reads: number;
  let now: number;
  let deps: StandingsDeps;

  beforeEach(async () => {
    store = memoryStore();
    reads = 0;
    now = GENESIS + 3 * 86_400;
    // 12 Holders: member i holds 20 − i NFTs. The first 10 posted this epoch, so 11 and 12 are below the cut line.
    for (let i = 1; i <= 12; i++) await join(store, `u${i}`, w(i), i);
    for (let i = 1; i <= 10; i++) {
      const p = { id: `q${i}`, userId: `u${i}`, wallet: w(i), kind: "note", text: "gm", at: (GENESIS + 60) * 1000 };
      await store.set(postKey(NFT, p.id), p);
      await recordActive(store, NFT, p, GENESIS, WEEK);
    }
    const holdings: Holdings = async (_token, wallets) => {
      reads++;
      return wallets.map((x) => BigInt(20 - Number(BigInt(x))));
    };
    deps = { now: () => now, clubs, events: async () => [swap(GENESIS + 100), swap(GENESIS - 100)], holdings, genesis: GENESIS, length: WEEK };
  });

  it("ranks every Holder, estimates the paid places from the fees so far", async () => {
    const s = (await clubStandings(store, club as ClubEntry, deps))!;
    assert.equal(s.n, 0);
    assert.equal(s.endsAt, GENESIS + WEEK);
    assert.equal(s.fees, (8n * ETH).toString(), "only this epoch's swap");
    assert.equal(s.rows.length, 12);
    assert.deepEqual(s.rows.slice(0, 3).map((r) => r.wallet), [w(1), w(2), w(3)]);
    const paid = s.rows.filter((r) => r.estimate);
    assert.equal(paid.length, REWARDS.maxHolders);
    const total = paid.reduce((sum, r) => sum + BigInt(r.estimate!), 0n);
    assert.ok(total <= BigInt(s.holderPool) && BigInt(s.holderPool) - total < 100n);
  });

  it("counts active days, and tells a reader below the cut line what gets them in", async () => {
    const p = { id: "p1", userId: "u11", wallet: w(11), kind: "note", text: "gm", at: (GENESIS + 60) * 1000 };
    await store.set(postKey(NFT, p.id), p);
    await recordActive(store, NFT, p, GENESIS, WEEK);
    const view = standingsView((await clubStandings(store, club as ClubEntry, deps))!, w(11));
    assert.ok(view.me && view.me.rank === 11);
    // Tied with the 10th on points, who holds more NFTs, so one more point.
    assert.equal("gap" in view.me ? view.me.gap : null, "0.01");
    assert.equal("days" in view.me ? view.me.days : null, 1);
    assert.deepEqual(view.me.activity, { days: 1, streak: 0, carried: 0 });
    assert.equal(standingsView((await clubStandings(store, club as ClubEntry, deps))!, w(99)).me?.rank, null);
  });

  it("serves the cache for a few minutes and in the same epoch only", async () => {
    await clubStandings(store, club as ClubEntry, deps);
    now += STANDINGS_TTL_SEC - 1;
    await clubStandings(store, club as ClubEntry, deps);
    assert.equal(reads, 1);
    now += 2;
    await clubStandings(store, club as ClubEntry, deps);
    assert.equal(reads, 2);
  });

  it("keeps the last copy when balances can't be read", async () => {
    const first = await clubStandings(store, club as ClubEntry, deps);
    now += STANDINGS_TTL_SEC + 1;
    const again = await clubStandings(store, club as ClubEntry, { ...deps, holdings: async () => null });
    assert.deepEqual(again, first);
  });
});
