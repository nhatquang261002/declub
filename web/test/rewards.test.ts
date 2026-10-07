import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import type { ActivityEvent } from "../lib/clubs";
import { buildMerkleSet, buildMerkleTree } from "../lib/merkle";
import type { MemberRow } from "../lib/members";
import { recapLink, recapText } from "../lib/recap";
import { CLUB_RULE_BOUNDS, DEFAULT_CLUB_RULES, REWARDS, checkRules, ownerRulesOf, rampBps, rampGap, seatsFor, whoIsPaid, entryGap, epochAt, epochWindow, leavesOf, pools, rankHolders, rewardLeaf, splitClub, streakBps, type ClubInput } from "../lib/rewards";
import { activeDays, activeKey, recordActive } from "../lib/server/activeDays";
import { liveStreak, readStreaks, standingsKey, streakAt } from "../lib/server/streaks";
import { postKey } from "../lib/server/board";
import { rolesKey } from "../lib/server/clubState";
import { memberKey, membersKey, type Holdings } from "../lib/server/members";
import { buildEpoch, carryKey, claimableFor, clubRewards, epochKey, lastKey, recordSponsor, removeSponsor, type RewardsDeps } from "../lib/server/rewards";
import { sponsorsByClub } from "../lib/server/sponsors";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets, type ClubEntry } from "../lib/verifiedAssets";

const ETH = 10n ** 18n;
const NFT: Address = getAddress("0x220a2c52fd27252e7cd6163a7bf1b6ae159d26e4");
const COIN: Address = getAddress("0x00000000000000000000000000000000000000c0");
const OTHER: Address = getAddress("0x00000000000000000000000000000000000000f1");
const REWARDS_AT: Address = getAddress("0x00000000000000000000000000000000000000ee");
const [alice, bob, carol, dave] = [
  "0xaaaa000000000000000000000000000000000001",
  "0xbbbb000000000000000000000000000000000002",
  "0xcccc000000000000000000000000000000000003",
  "0xdddd000000000000000000000000000000000004",
];

// ─────────────────────────────────────────────────────────────── merkle

/** What OpenZeppelin's `MerkleProof.verify` does with a sorted-pair tree. */
function verify(proof: readonly Hex[], root: Hex, leaf: Hex): boolean {
  let node = leaf;
  for (const sibling of proof) {
    const [a, b] = node.toLowerCase() <= sibling.toLowerCase() ? [node, sibling] : [sibling, node];
    node = keccak256(`0x${a.slice(2)}${b.slice(2)}` as Hex);
  }
  return node === root;
}

describe("buildMerkleTree", () => {
  it("gives every leaf a proof that verifies, for any number of leaves", () => {
    for (let n = 1; n <= 17; n++) {
      const leaves = Array.from({ length: n }, (_, i) => keccak256(`0x${(i + 1).toString(16).padStart(2, "0")}` as Hex));
      const { root, proofs } = buildMerkleTree(leaves);
      leaves.forEach((leaf, i) => assert.ok(verify(proofs[i]!, root, leaf), `leaf ${i} of ${n}`));
      assert.ok(!verify(proofs[0]!, root, keccak256("0xff")), "a stranger's leaf doesn't verify");
    }
  });

  it("has an empty proof and the leaf as root for one leaf, and 0x for none", () => {
    const leaf = keccak256("0x01");
    assert.deepEqual(buildMerkleTree([leaf]), { root: leaf, proofs: [[]] });
    assert.deepEqual(buildMerkleTree([]), { root: "0x", proofs: [] });
  });

  it("still builds trait sets: sorted, de-duplicated ids, a proof each", () => {
    const set = buildMerkleSet([5n, 2n, 5n, 9n], NFT);
    assert.equal(set.count, 3);
    assert.deepEqual([...set.proofs.keys()], [2n, 5n, 9n]);
  });
});

// ─────────────────────────────────────────────────────────────── pure parts

describe("epochs", () => {
  it("are back to back from genesis", () => {
    assert.deepEqual(epochWindow(0, 1_000, 100), { n: 0, start: 1_000, end: 1_100 });
    assert.deepEqual(epochWindow(3, 1_000, 100), { n: 3, start: 1_300, end: 1_400 });
    assert.equal(epochAt(999, 1_000, 100), -1);
    assert.equal(epochAt(1_000, 1_000, 100), 0);
    assert.equal(epochAt(1_399, 1_000, 100), 3);
    assert.equal(epochAt(1_400, 1_000, 100), 4);
  });
});

describe("rewardLeaf", () => {
  it("hashes the contract's encoding twice", () => {
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "address" }, { type: "uint256" }],
        [10143n, REWARDS_AT, 4n, getAddress(alice), 3n * ETH],
      ),
    );
    assert.equal(rewardLeaf(10143, REWARDS_AT, 4, getAddress(alice), 3n * ETH), keccak256(inner));
    assert.notEqual(rewardLeaf(143, REWARDS_AT, 4, getAddress(alice), 3n * ETH), keccak256(inner), "bound to the chain");
  });
});

describe("splitClub", () => {
  const input = (over: Partial<ClubInput> = {}): ClubInput => ({
    club: NFT.toLowerCase(),
    fees: 10n * ETH,
    carried: { holders: 0n, fund: 0n },
    holders: [],
    owner: null,
    ...over,
  });

  it("takes the shares in REWARDS from the fees", () => {
    assert.equal(REWARDS.holderBps + REWARDS.fundBps + REWARDS.protocolBps, 10_000);
    assert.deepEqual(pools(10n * ETH, { holders: 1n, fund: 2n }), { holderPool: 5n * ETH + 1n, fundPool: (25n * ETH) / 10n + 2n });
  });

  it("pays Holders by shares, and the fund to the Owner", () => {
    const split = splitClub(input({ holders: [{ wallet: alice, shares: 3n, points: 12 }, { wallet: bob, shares: 1n, points: 12 }], owner: carol }));
    assert.deepEqual(
      split.payouts.map((p) => [p.wallet, p.kind, p.amount]),
      [[alice, "holder", (375n * ETH) / 100n], [bob, "holder", (125n * ETH) / 100n], [carol, "fund", (25n * ETH) / 10n]],
    );
    assert.deepEqual(split.carry, { holders: 0n, fund: 0n });
    assert.equal(split.holderCount, 2);
  });

  it("adds a sponsor's money to the Holder pool only: none to the fund, none to the protocol (ADR 0035)", () => {
    assert.deepEqual(pools(10n * ETH, { holders: 0n, fund: 0n }, 7n * ETH), { holderPool: 12n * ETH, fundPool: (25n * ETH) / 10n });
    const split = splitClub(input({ sponsored: 7n * ETH, holders: [{ wallet: alice, shares: 3n, points: 12 }, { wallet: bob, shares: 1n, points: 12 }], owner: carol }));
    assert.equal(split.sponsored, 7n * ETH);
    assert.deepEqual(
      split.payouts.map((p) => [p.wallet, p.kind, p.amount]),
      [[alice, "holder", 9n * ETH], [bob, "holder", 3n * ETH], [carol, "fund", (25n * ETH) / 10n]],
    );
  });

  it("rolls a sponsor's money into the next epoch when the Club has no Holders", () => {
    const split = splitClub(input({ fees: 0n, sponsored: 4n * ETH }));
    assert.deepEqual(split.payouts, []);
    assert.deepEqual(split.carry, { holders: 4n * ETH, fund: 0n });
  });

  it("rolls the pools over when there are no Holders or no Owner", () => {
    const split = splitClub(input({ carried: { holders: 1n, fund: 1n } }));
    assert.deepEqual(split.payouts, []);
    assert.deepEqual(split.carry, { holders: 5n * ETH + 1n, fund: (25n * ETH) / 10n + 1n });
  });

  it("rolls rounding dust over and never pays more than the pool", () => {
    const split = splitClub(input({ fees: 10n, holders: [{ wallet: alice, shares: 1n, points: 12 }, { wallet: bob, shares: 1n, points: 12 }, { wallet: carol, shares: 1n, points: 12 }] }));
    // A 5-wei pool over 3 equal Holders: 1 each, 2 left.
    assert.equal(split.holderPool, 5n);
    assert.equal(split.paidHolders, 3n);
    assert.equal(split.carry.holders, 2n);
  });

  it("leaves zero-share members out", () => {
    const split = splitClub(input({ holders: [{ wallet: alice, shares: 0n, points: 12 }, { wallet: bob, shares: 2n, points: 12 }] }));
    assert.deepEqual(split.payouts.map((p) => p.wallet), [bob]);
    assert.equal(split.holderCount, 1);
  });
});

describe("who is paid, and how much (ADR 0040, ADR 0044)", () => {
  const club = NFT.toLowerCase();
  const w = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ wallet: w(i + 1), shares: BigInt(100 - i), points: 40 - i, joinedAt: i }));
  const base = { club, fees: 10n * ETH, carried: { holders: 0n, fund: 0n }, owner: null };
  const rules = (over: Partial<typeof DEFAULT_CLUB_RULES>) => ({ ...DEFAULT_CLUB_RULES, ...over });

  it("pays every Holder with some activity by default, and nobody with none", () => {
    const quiet = [{ wallet: w(90), shares: 500n, points: 0.5, joinedAt: 0 }, { wallet: w(91), shares: 500n, points: 0, joinedAt: 0 }];
    const split = splitClub({ ...base, holders: [...many(15).reverse(), ...quiet] });
    assert.equal(split.holderCount, 15);
    assert.deepEqual(new Set(split.payouts.map((p) => p.wallet)), new Set(many(15).map((h) => h.wallet)), `under ${REWARDS.minPaidPoints} point isn't paid`);
    assert.equal(split.paidHolders + split.carry.holders, split.holderPool);
    // Alone in the Club and quiet: nothing is paid, and the pool rolls over.
    const alone = splitClub({ ...base, holders: [quiet[1]!] });
    assert.deepEqual(alone.payouts, []);
    assert.equal(alone.carry.holders, alone.holderPool);
  });

  it("ramps a Holder's share up to rampPoints, with no cliff", () => {
    const holders = [
      { wallet: w(1), shares: 4n, points: REWARDS.rampPoints, joinedAt: 0 },
      { wallet: w(2), shares: 4n, points: REWARDS.rampPoints / 2, joinedAt: 0 },
      { wallet: w(3), shares: 4n, points: REWARDS.rampPoints * 9, joinedAt: 0 },
    ];
    const amount = (split: ReturnType<typeof splitClub>, i: number) => split.payouts.find((p) => p.wallet === w(i))!.amount;
    // No bonus here, so the weights are 1 : 0.5 : 1 of the same 4 NFTs.
    const split = splitClub({ ...base, holders });
    assert.equal(amount(split, 2) * 2n, amount(split, 1));
    assert.equal(amount(split, 3), amount(split, 1), "past the ramp, more points don't add to the share");
    assert.deepEqual([0, 0.5, 1, 2.5, 5, 50].map((p) => rampBps(p)), [0, 0, 2_000, 5_000, 10_000, 10_000]);
    // The Owner sets the ramp.
    assert.equal(rampBps(5, rules({ rampPoints: 20 })), 2_500);
  });

  it("ranks ties on points for the bigger holding, then the earlier member, then the lower wallet", () => {
    const tied = [
      { wallet: w(50), shares: 1n, points: 1, joinedAt: 5 },
      { wallet: w(51), shares: 1n, points: 1, joinedAt: 3 },
      { wallet: w(40), shares: 1n, points: 1, joinedAt: 3 },
      { wallet: w(60), shares: 2n, points: 1, joinedAt: 9 },
    ];
    assert.deepEqual(rankHolders(tied).map((h) => h.wallet), [w(60), w(40), w(51), w(50)]);
  });

  it("pays only the most active Holders when the Owner limits the places, by number, percentage or both", () => {
    assert.deepEqual([0, 1, 9, 10, 15].map((n) => seatsFor(n)), [0, 1, 9, 10, 15], "no limit by default");
    assert.equal(seatsFor(15, rules({ maxPaid: 3 })), 3);
    assert.equal(seatsFor(15, rules({ maxPaidPercent: 20 })), 3, "20% of 15");
    assert.equal(seatsFor(11, rules({ maxPaidPercent: 20 })), 3, "rounded up");
    assert.equal(seatsFor(2, rules({ maxPaidPercent: 1 })), 1, "at least one");
    assert.equal(seatsFor(15, rules({ maxPaid: 2, maxPaidPercent: 50 })), 2, "whichever is fewer");
    const split = splitClub({ ...base, holders: many(15).reverse(), rules: rules({ maxPaid: 3 }) });
    assert.deepEqual(split.payouts.map((p) => p.wallet).sort(), [w(1), w(2), w(3)]);
    // The percentage counts every Holder, active or not.
    const idle = Array.from({ length: 5 }, (_, i) => ({ wallet: w(300 + i), shares: 1n, points: 0, joinedAt: 0 }));
    assert.equal(splitClub({ ...base, holders: [...many(5), ...idle], rules: rules({ maxPaidPercent: 50 }) }).holderCount, 5);
  });

  it("says how many more points a Holder needs to be paid, and to be paid in full", () => {
    const ranked = rankHolders([...many(3), { wallet: w(70), shares: 5n, points: 0.25, joinedAt: 20 }]);
    assert.equal(entryGap(ranked, w(70)), 0.75, "to the one point that pays");
    assert.equal(entryGap(ranked, w(1)), 0);
    assert.equal(entryGap(ranked, w(123)), null);
    // With three places, the 4th needs to pass the 3rd (38 points, 98 NFTs): a tie isn't enough with fewer NFTs.
    const limited = rankHolders([...many(3), { wallet: w(71), shares: 5n, points: 30, joinedAt: 20 }]);
    assert.equal(entryGap(limited, w(71), rules({ maxPaid: 3 })), 8.01);
    assert.equal(rampGap(2), REWARDS.rampPoints - 2);
    assert.equal(rampGap(40), 0);
  });

  it("gives members without NFTs the Owner's slice, split by points, and keeps it with the Holders when none has any", () => {
    const holders = [{ wallet: w(1), shares: 2n, points: 20, joinedAt: 0 }];
    const members = [
      { wallet: w(10), shares: 0n, points: 10, joinedAt: 0 },
      { wallet: w(11), shares: 0n, points: 500, joinedAt: 0 },
      { wallet: w(12), shares: 0n, points: 0, joinedAt: 0 },
    ];
    const off = splitClub({ ...base, holders, members });
    assert.equal(off.paidMembers, 0n, "off by default");
    const split = splitClub({ ...base, holders, members, rules: rules({ nonHolderBps: 2_000 }) });
    const paid = Object.fromEntries(split.payouts.map((p) => [p.wallet, [p.kind, p.amount]]));
    // 5 MON Holder pool: 1 to the members, 4 to the Holder. Points count up to fullBonusPoints (35): 10 : 35.
    assert.deepEqual(paid[w(1)], ["holder", 4n * ETH]);
    assert.deepEqual(paid[w(10)], ["member", (ETH * 1_000n) / 4_500n]);
    assert.deepEqual(paid[w(11)], ["member", (ETH * 3_500n) / 4_500n]);
    assert.equal(paid[w(12)], undefined);
    assert.equal(split.memberCount, 2);
    assert.equal(split.paidHolders + split.paidMembers + split.carry.holders, split.holderPool);
    const nobody = splitClub({ ...base, holders, members: [members[2]!], rules: rules({ nonHolderBps: 2_000 }) });
    assert.equal(nobody.paidHolders, 5n * ETH, "no member earned any, so the Holders keep it");
  });

  it("checks rules an Owner sends against their bounds", () => {
    assert.deepEqual(checkRules({ rampPoints: 8, maxPaid: 10 }), { ok: true, rules: { ...DEFAULT_CLUB_RULES, rampPoints: 8, maxPaid: 10 } });
    assert.deepEqual(checkRules({ maxPaid: 3 }, rules({ rampPoints: 8 })), { ok: true, rules: rules({ rampPoints: 8, maxPaid: 3 }) }, "rules not sent keep their value");
    assert.equal(checkRules({ nonHolderBps: 5_000 }).ok, false, "at most 30% to members without NFTs");
    assert.equal(checkRules({ maxPaid: 2.5 }).ok, false, "a count is whole");
    assert.equal(checkRules({ holderBps: 9_000 }).ok, false, "the fee split isn't a Club rule");
    for (const rule of ["voicePerNft", "pairCap", "fullBonusPoints", "dayPoints", "swapPoints", "streakStepBps"]) {
      assert.equal(checkRules({ [rule]: DEFAULT_CLUB_RULES[rule as keyof typeof DEFAULT_CLUB_RULES] }).ok, false, `${rule}: how points count is the same in every Club`);
    }
    assert.deepEqual(ownerRulesOf({ ...DEFAULT_CLUB_RULES, maxPaid: 4, voicePerNft: 50, pairCap: 60 }), { ...DEFAULT_CLUB_RULES, maxPaid: 4 }, "a save can't carry anything but the paying rules");
    assert.equal(checkRules({ rampPoints: "5" }).ok, false);
    assert.equal(checkRules([]).ok, false);
    for (const [key, [least, most]] of Object.entries(CLUB_RULE_BOUNDS)) {
      const value = DEFAULT_CLUB_RULES[key as keyof typeof DEFAULT_CLUB_RULES];
      assert.ok(value >= least && value <= most, `${key} default is inside its bounds`);
    }
    assert.equal(REWARDS.rampPoints, DEFAULT_CLUB_RULES.rampPoints, "REWARDS stays an alias of the defaults");
    assert.equal(whoIsPaid(), "every active Holder");
    assert.equal(whoIsPaid(rules({ maxPaid: 10 })), "the 10 most active Holders");
    assert.equal(whoIsPaid(rules({ maxPaidPercent: 20, maxPaid: 10 })), "the most active 20% of Holders, at most 10");
  });

  it("leaves a ring of one-NFT accounts earning about what its NFTs would honestly, with nobody pushed out", () => {
    const ring = Array.from({ length: 10 }, (_, i) => ({ wallet: w(200 + i), shares: 1n, points: 35, bonusBps: 5_000, joinedAt: 0 }));
    const real = { wallet: w(1), shares: 12n, points: 35, bonusBps: 5_000, joinedAt: 0 };
    const split = splitClub({ ...base, holders: [real, ...ring] });
    assert.equal(split.holderCount, 11, "the real Holder is paid next to the ring");
    const ringPaid = split.payouts.filter((p) => ring.some((r) => r.wallet === p.wallet));
    assert.equal(ringPaid.length, 10);
    // Equal bonus: each ring account holds 1 of 22 NFTs, so it gets what one honestly held NFT would.
    for (const p of ringPaid) assert.equal(p.amount, (5n * ETH) / 22n);
    assert.equal(split.payouts.find((p) => p.wallet === w(1))!.amount, (5n * ETH * 12n) / 22n);
  });

  it("splits by the NFTs held on average over the week, not the ones held at close", () => {
    // Both hold 5 at close; one held 5 all week (7 samples + close = 40 NFT-reads), the other bought them on the last day (5 only at close).
    const holders = [
      { wallet: w(1), shares: 5n, held: 40n, points: 20, joinedAt: 0 },
      { wallet: w(2), shares: 5n, held: 5n, points: 20, joinedAt: 0 },
    ];
    const split = splitClub({ ...base, holders, samples: 7 });
    const [a, b] = ["1", "2"].map((i) => split.payouts.find((p) => p.wallet === w(Number(i)))!);
    assert.equal(a!.amount, (5n * ETH * 40n) / 45n);
    assert.equal(a!.held, 5);
    assert.equal(b!.held, 0.63, "5 over 8 reads, to 2 decimals");
    assert.equal(a!.shares, 5n, "what they hold now is still published");
    assert.equal(split.samples, 7);
    // Without samples, held is the holding and nothing changes.
    const none = splitClub({ ...base, holders: [{ wallet: w(1), shares: 5n, points: 20 }, { wallet: w(2), shares: 5n, points: 20 }] });
    assert.equal(none.payouts[0]!.amount, none.payouts[1]!.amount);
  });

  it("adds the streak bonus on top of the activity bonus, each capped", () => {
    assert.deepEqual([0, 1, 2, 3, 5, 40].map((n) => streakBps(n)), [0, 0, 250, 500, 1_000, 1_000]);
    assert.equal(REWARDS.maxBonusBps, 2_500, "the activity bonus is at most +25% (ADR 0044)");
    const holders = [
      { wallet: w(1), shares: 1n, points: 10, bonusBps: 99_999, streak: 99 },
      { wallet: w(2), shares: 1n, points: 10 },
    ];
    const split = splitClub({ ...base, holders });
    const top = split.payouts.find((p) => p.wallet === w(1))!;
    assert.equal(top.bonusBps, REWARDS.maxBonusBps + REWARDS.maxStreakBps);
    assert.equal(top.streak, 99);
    // Weights 1.35 : 1 of a 5 MON pool.
    assert.equal(top.amount, (5n * ETH * 13_500n) / 23_500n);
  });
});

describe("active days and streaks", () => {
  const club = NFT.toLowerCase();
  const post = (id: string, userId: string, at: number, over: object = {}) => ({ id, userId, wallet: alice, kind: "note", text: "gm", at: at * 1000, ...over });

  it("work with Privy user ids, which contain colons", async () => {
    const store = memoryStore();
    const day = 86_400;
    const id = "did:privy:cm0abc123";
    const posts = [post("p1", id, GENESIS + 10), post("p2", id, GENESIS + day + 5)];
    for (const p of posts) {
      await store.set(postKey(club, p.id), p);
      await recordActive(store, club, p, GENESIS, WEEK);
    }
    assert.deepEqual(Object.fromEntries(await activeDays(store, club, 0)), { [id]: 2 });
  });

  it("count a member's distinct days with a post still shown", async () => {
    const store = memoryStore();
    const day = 86_400;
    const epochs = [GENESIS, WEEK] as const;
    const posts = [post("a1", "ua", GENESIS + 10), post("a2", "ua", GENESIS + 20), post("a3", "ua", GENESIS + day + 5), post("a4", "ua", GENESIS + 2 * day, { hidden: "moderator" }), post("b1", "ub", GENESIS + 3 * day)];
    for (const p of posts) {
      await store.set(postKey(club, p.id), p);
      await recordActive(store, club, p, ...epochs);
    }
    // A deleted post earns nothing either.
    await recordActive(store, club, post("gone", "ub", GENESIS + 4 * day), ...epochs);
    assert.deepEqual(Object.fromEntries(await activeDays(store, club, 0)), { ua: 2, ub: 1 });
    // Before genesis nothing is recorded.
    await recordActive(store, club, post("early", "ua", GENESIS - 10), ...epochs);
    assert.equal((await store.members(activeKey(club, -1))).length, 0);
  });

  it("run on qualifying epochs in a row, and lapse after a gap", () => {
    assert.equal(streakAt(undefined, 4, true), 1);
    assert.equal(streakAt({ n: 3, count: 2 }, 4, true), 3);
    assert.equal(streakAt({ n: 2, count: 2 }, 4, true), 1);
    assert.equal(streakAt({ n: 3, count: 2 }, 4, false), 0);
    assert.equal(liveStreak({ n: 3, count: 2 }, 4), 2, "still alive while epoch 4 runs");
    assert.equal(liveStreak({ n: 3, count: 2 }, 5), 0);
  });
});

describe("the weekly recap", () => {
  const recap = { symbol: "CHOG", epoch: 3, fees: 12n * ETH, paidHolders: 6n * ETH, holderCount: 10 };

  it("says who was paid and the week's fees, in a short post", () => {
    const text = recapText(recap);
    assert.match(text, /^CHOG Club just paid its 10 most active Holders 6 MON /);
    assert.match(text, /12 MON in swap fees this week/);
    assert.ok(text.length + 24 <= 280, "with a link, within X's limit");
    assert.match(recapText({ ...recap, paidHolders: 1234n * 10n ** 14n, holderCount: 1 }), /paid its most active Holder 0\.12 MON/);
    assert.match(recapText({ ...recap, paidHolders: 5n * 10n ** 15n }), /paid its 10 most active Holders <0\.01 MON/);
  });

  it("says who sponsored the week, and stays within X's limit with long names", () => {
    assert.ok(!recapText(recap).includes("sponsored"));
    assert.match(recapText({ ...recap, sponsored: 5n * ETH, sponsors: ["Monad Foundation"] }), /🎁 5 MON sponsored by Monad Foundation/);
    assert.match(recapText({ ...recap, sponsored: 5n * ETH, sponsors: ["A", "B"] }), /sponsored by A and B/);
    assert.match(recapText({ ...recap, sponsored: 5n * ETH, sponsors: ["A", "B", "C", "D"] }), /sponsored by A, B and 2 more/);
    const long = "x".repeat(40);
    assert.ok(recapText({ ...recap, sponsored: 5n * ETH, sponsors: [long, long, long] }).length + 24 <= 280);
  });

  it("leaves out the payout line when nobody was paid, and links the Club's page", () => {
    assert.ok(!recapText({ ...recap, paidHolders: 0n, holderCount: 0 }).includes("most active"));
    assert.match(recapText({ ...recap, paidHolders: 0n, holderCount: 0 }), /^CHOG Club made 12 MON in swap fees/);
    assert.match(recapText({ ...recap, fees: 0n, paidHolders: 0n, holderCount: 0 }), /^A quiet week for the CHOG Club/);
    const link = new URL(recapLink(recap, "https://declub.app/clubs/0xabc"));
    assert.equal(link.origin + link.pathname, "https://x.com/intent/post");
    assert.equal(link.searchParams.get("url"), "https://declub.app/clubs/0xabc");
  });
});

describe("leavesOf", () => {
  it("sums one wallet across Clubs, keeps the breakdown, and orders by address", () => {
    const a = splitClub({ club: "0x1", fees: 10n * ETH, carried: { holders: 0n, fund: 0n }, holders: [{ wallet: bob, shares: 1n, points: 12 }], owner: alice });
    const b = splitClub({ club: "0x2", fees: 5n * ETH, carried: { holders: 0n, fund: 0n }, holders: [{ wallet: alice, shares: 1n, points: 12 }], owner: null });
    const leaves = leavesOf([a, b]);
    assert.deepEqual(leaves.map((l) => [l.account, l.amount]), [[getAddress(alice), (25n * ETH) / 10n + (25n * ETH) / 10n], [getAddress(bob), 5n * ETH]]);
    assert.deepEqual(leaves[0]!.breakdown, [
      { club: "0x1", kind: "fund", amount: (25n * ETH) / 10n },
      { club: "0x2", kind: "holder", amount: (25n * ETH) / 10n, shares: 1n, bonusBps: 0, points: 12 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────── the builder

const GENESIS = 1_800_000_000;
const WEEK = 604_800;

const entries = parseAssets([
  { chainId: 10143, address: NFT, kind: "erc721", name: "Mock Chog", symbol: "MCHOG", status: "verified", note: "x" },
  { chainId: 10143, address: COIN, kind: "erc20", category: "memecoin", name: "Chog coin", symbol: "CHOG", status: "verified", note: "x", club: NFT, minHolding: "100" },
  { chainId: 10143, address: OTHER, kind: "erc721", name: "Other", symbol: "OTH", status: "verified", note: "x" },
]);
const clubs = makeRegistry(entries).clubs(10143);

let seq = 0;
const swap = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `0x${(++seq).toString(16)}:0`,
  kind: "swapped",
  contract: "0xswap",
  deal: String(seq),
  block: seq,
  at: GENESIS + 100,
  parties: [alice, bob],
  tokens: [NFT.toLowerCase()],
  fee: (4n * ETH).toString(),
  ...over,
});

async function join(store: Store, club: Address, userId: string, wallets: string[]) {
  const row: MemberRow = { userId, wallets, displayWallet: wallets[0], holder: true, holderCheckedAt: 1, joinedAt: 1 };
  await store.set(memberKey(club, userId), row);
  await store.addMember(membersKey(club), userId);
}

/** Balances by token, then by wallet. Anything unlisted holds nothing. */
const holdingsOf = (table: Record<string, Record<string, bigint>>): Holdings => async (token, wallets) =>
  wallets.map((w) => table[token.toLowerCase()]?.[w.toLowerCase()] ?? 0n);

/** A visible Board post, so the member has an active day (and so some points) in that epoch. */
async function postOnBoard(store: Store, userId: string, wallet: string, at: number, club: Address = NFT) {
  const p = { id: `p${at}-${userId}`, userId, wallet, kind: "note", text: "gm", at: at * 1000 };
  await store.set(postKey(club.toLowerCase(), p.id), p);
  await recordActive(store, club.toLowerCase(), p, GENESIS, WEEK);
}

describe("buildEpoch", () => {
  let store: Store;
  let events: Map<string, ActivityEvent[]>;
  let deps: RewardsDeps;

  beforeEach(async () => {
    store = memoryStore();
    events = new Map();
    deps = {
      now: () => GENESIS + WEEK,
      clubs,
      events: async (club: ClubEntry) => events.get(club.address) ?? [],
      holdings: holdingsOf({
        [NFT.toLowerCase()]: { [alice]: 2n, [dave]: 1n },
        [COIN.toLowerCase()]: { [bob]: 250n },
      }),
      settlementFee: async () => 6n * ETH,
      chainId: 10143,
      contract: REWARDS_AT,
      genesis: GENESIS,
      length: WEEK,
      // A floor of one point: most of these tests have a swap or a post, not ten points of backing.
      rules: () => ({ ...DEFAULT_CLUB_RULES, minPoints: 1 }),
    };
    // Alice holds 2 Chogs; Bob holds 250 coin in a second wallet, a Holder by the coin but with no
    // shares (ADR 0025); Carol is a member with nothing; Dave (1 Chog) isn't a member and earns nothing.
    await join(store, NFT, "ua", [alice]);
    await join(store, NFT, "ub", [carol, bob]);
    await store.set(rolesKey(NFT), { owner: "ua", moderators: [] });
  });

  it("waits for the epoch to end, and needs a rewards contract", async () => {
    assert.deepEqual(await buildEpoch(store, 0, { ...deps, now: () => GENESIS + WEEK - 1 }), { status: "open", endsAt: GENESIS + WEEK });
    assert.deepEqual(await buildEpoch(store, 0, { ...deps, contract: undefined }), { status: "unconfigured" });
  });

  it("splits a Club's fees between its Holders by shares and its Owner", async () => {
    events.set(NFT, [swap(), swap({ at: GENESIS - 1 }), swap({ at: GENESIS + WEEK }), swap({ kind: "created" })]);
    const result = await buildEpoch(store, 0, deps);
    assert.equal(result.status, "built");
    const record = result.status === "built" ? result.record : undefined!;

    // Only the swap inside the window counts: 4 MON of fees, 2 to Holders, 1 to the fund.
    const chog = record.clubs.find((c) => c.club === NFT.toLowerCase())!;
    assert.equal(chog.fees, (4n * ETH).toString());
    assert.equal(chog.holderPool, (2n * ETH).toString());
    assert.equal(chog.fundPool, (1n * ETH).toString());
    assert.equal(chog.holderCount, 1);

    // Alice: the whole Holder pool (2) plus the fund (1). Bob's coin earns nothing: rewards
    // follow the collection's NFTs only.
    const byAccount = Object.fromEntries(record.leaves.map((l) => [l.account.toLowerCase(), BigInt(l.amount)]));
    assert.deepEqual(byAccount, { [alice]: 3n * ETH });
    assert.equal(record.total, (3n * ETH).toString());

    // Every proof verifies against the root with the contract's leaf.
    for (const leaf of record.leaves) {
      assert.ok(verify(leaf.proof, record.root, rewardLeaf(10143, REWARDS_AT, 0, leaf.account, BigInt(leaf.amount))));
    }
  });

  it("counts active days in the bonus, and moves streaks along for every member", async () => {
    events.set(NFT, [swap()]);
    const club = NFT.toLowerCase();
    const day = 86_400;
    // Alice posts on 4 days (a streak from last epoch too); Carol, with no shares, on 3.
    await store.set(`declub:rewards:10143:streaks:${club}`, { ua: { n: -1, count: 2 } });
    for (let d = 0; d < 4; d++) {
      const p = { id: `a${d}`, userId: "ua", wallet: alice, kind: "note", text: "gm", at: (GENESIS + d * day + 60) * 1000 };
      await store.set(postKey(club, p.id), p);
      await recordActive(store, club, p, GENESIS, WEEK);
    }
    for (let d = 0; d < 3; d++) {
      const p = { id: `c${d}`, userId: "ub", wallet: carol, kind: "note", text: "gm", at: (GENESIS + d * day + 60) * 1000 };
      await store.set(postKey(club, p.id), p);
      await recordActive(store, club, p, GENESIS, WEEK);
    }
    const result = await buildEpoch(store, 0, deps);
    const record = result.status === "built" ? result.record : undefined!;
    const holder = record.leaves.find((l) => l.account.toLowerCase() === alice)!.breakdown.find((b) => b.kind === "holder")!;
    assert.equal(holder.days, 4);
    assert.equal(holder.streak, 3);
    assert.equal(holder.points, 4 * REWARDS.dayPoints + REWARDS.swapPoints, "four active days and the epoch's one swap");
    assert.deepEqual(await readStreaks(store, club), { ua: { n: 0, count: 3 }, ub: { n: 0, count: 1 } });
  });

  it("splits a swap that names two Clubs evenly between them", async () => {
    const both = swap({ tokens: [NFT.toLowerCase(), OTHER.toLowerCase()] });
    events.set(NFT, [both]);
    events.set(OTHER, [both]);
    const result = await buildEpoch(store, 0, deps);
    const record = result.status === "built" ? result.record : undefined!;
    assert.equal(record.clubs.find((c) => c.club === NFT.toLowerCase())!.fees, (2n * ETH).toString());
    assert.equal(record.clubs.find((c) => c.club === OTHER.toLowerCase())!.fees, (2n * ETH).toString());
  });

  it("reads a signed swap's fee from its settlement", async () => {
    const intents = "0x00000000000000000000000000000000000000ab";
    const read: string[] = [];
    const settled = swap({ contract: intents, deal: "0x" + "12".repeat(32), fee: undefined });
    events.set(NFT, [settled]);
    const result = await buildEpoch(store, 0, { ...deps, intents, settlementFee: async (hash) => (read.push(hash), 6n * ETH) });
    assert.deepEqual(read, [settled.deal]);
    assert.equal(result.status === "built" && result.record.clubs[0]!.fees, (6n * ETH).toString());
  });

  it("adds recorded sponsors to the Holder pool, publishes who gave what, and funds it in the total", async () => {
    events.set(NFT, [swap()]);
    await recordSponsor(store, 0, { club: NFT, amount: 10n * ETH, sponsor: "Monad Foundation", kind: "partner" });
    await recordSponsor(store, 0, { club: NFT, amount: 2n * ETH, sponsor: "Chog team", kind: "owner" });
    await recordSponsor(store, 0, { club: NFT, amount: 1n * ETH, sponsor: "Monad Foundation", kind: "partner" });
    const result = await buildEpoch(store, 0, deps);
    const record = result.status === "built" ? result.record : undefined!;
    const line = record.clubs.find((c) => c.club === NFT.toLowerCase())!;
    // 4 MON of fees: Holders 2, fund 1. Sponsors add 13 to the Holders.
    assert.equal(line.sponsored, (13n * ETH).toString());
    assert.deepEqual(line.sponsors, [
      { sponsor: "Monad Foundation", kind: "partner", amount: (11n * ETH).toString() },
      { sponsor: "Chog team", kind: "owner", amount: (2n * ETH).toString() },
    ]);
    assert.equal(line.holderPool, (15n * ETH).toString());
    assert.equal(line.paidHolders, (15n * ETH).toString());
    assert.equal(line.paidFund, (1n * ETH).toString());
    assert.equal(record.total, (16n * ETH).toString(), "the total the operator funds covers the sponsors");
    assert.equal(record.clubs.find((c) => c.club === OTHER.toLowerCase())!.sponsored, undefined, "a Club nobody sponsored has no line");
  });

  it("pays a sponsored epoch with no swaps to an active Holder, and carries it when the Club has no Holders", async () => {
    await postOnBoard(store, "ua", alice, GENESIS + 10);
    await recordSponsor(store, 0, { club: NFT, amount: 3n * ETH, sponsor: "A", kind: "partner" });
    await recordSponsor(store, 0, { club: OTHER, amount: 5n * ETH, sponsor: "B", kind: "partner" });
    const result = await buildEpoch(store, 0, deps);
    const record = result.status === "built" ? result.record : undefined!;
    assert.equal(record.clubs.find((c) => c.club === NFT.toLowerCase())!.paidHolders, (3n * ETH).toString());
    assert.equal(record.total, (3n * ETH).toString(), "only what is paid is funded");
    assert.deepEqual(await store.get(carryKey(OTHER)), { holders: (5n * ETH).toString(), fund: "0" });
  });

  it("drops the cached live standings when a sponsor is recorded or removed, so the pool shows it at once", async () => {
    await store.set(standingsKey(NFT), { stale: true });
    await recordSponsor(store, 0, { club: NFT, amount: ETH, sponsor: "A", kind: "partner", tx: "0xabc" });
    assert.equal(await store.get(standingsKey(NFT)), null);
    await store.set(standingsKey(NFT), { stale: true });
    await removeSponsor(store, 0, "0xabc");
    assert.equal(await store.get(standingsKey(NFT)), null);
  });

  it("refuses a sponsor once the epoch is built, or for nothing, or without a name", async () => {
    assert.equal((await recordSponsor(store, 0, { club: NFT, amount: 0n, sponsor: "A", kind: "partner" })).status, "invalid");
    assert.equal((await recordSponsor(store, 0, { club: NFT, amount: ETH, sponsor: "  \n ", kind: "partner" })).status, "invalid");
    assert.equal((await recordSponsor(store, -1, { club: NFT, amount: ETH, sponsor: "A", kind: "partner" })).status, "invalid");
    await buildEpoch(store, 0, deps);
    assert.deepEqual(await recordSponsor(store, 0, { club: NFT, amount: ETH, sponsor: "A", kind: "partner" }), { status: "built" });
    assert.equal((await recordSponsor(store, 1, { club: NFT, amount: ETH, sponsor: "A", kind: "partner" })).status, "recorded", "the next epoch still takes it");
  });

  it("keeps sponsor names to one short line", async () => {
    const result = await recordSponsor(store, 2, { club: NFT, amount: ETH, sponsor: `  Big\n\tSponsor ${"x".repeat(100)} `, kind: "partner" });
    const [entry] = result.status === "recorded" ? result.entries : [];
    assert.ok(entry!.sponsor.length <= 40);
    assert.ok(!/[\n\t]/.test(entry!.sponsor));
    assert.ok(entry!.sponsor.startsWith("Big Sponsor "));
    assert.deepEqual([...sponsorsByClub([entry!]).keys()], [NFT.toLowerCase()]);
  });

  it("shows the running epoch's sponsors on the Club's view before it closes", async () => {
    const genesis = 1_791_158_400;
    await recordSponsor(store, 0, { club: NFT, amount: 6n * ETH, sponsor: "Monad Foundation", kind: "partner" });
    const view = await clubRewards(store, NFT, genesis + 100);
    assert.deepEqual(view.open, { n: 0, sponsored: (6n * ETH).toString(), sponsors: [{ sponsor: "Monad Foundation", kind: "partner", amount: (6n * ETH).toString() }] });
    assert.equal((await clubRewards(store, OTHER, genesis + 100)).open, undefined);
    assert.equal((await clubRewards(store, NFT, genesis + WEEK + 100)).open, undefined, "the next epoch has none");
  });

  it("rolls what it can't pay into the next epoch, and pays it then", async () => {
    // Epoch 0: the Other Club has fees but no members and no Owner.
    events.set(OTHER, [swap({ tokens: [OTHER.toLowerCase()] })]);
    await buildEpoch(store, 0, deps);
    assert.deepEqual(await store.get(carryKey(OTHER)), { holders: (2n * ETH).toString(), fund: (1n * ETH).toString() });

    // Epoch 1: someone holding an Other NFT joins and is paid the rolled-over Holder pool.
    events.set(OTHER, []);
    await join(store, OTHER, "ud", [dave]);
    await postOnBoard(store, "ud", dave, GENESIS + WEEK + 10, OTHER);
    const result = await buildEpoch(store, 1, { ...deps, now: () => GENESIS + 2 * WEEK, holdings: holdingsOf({ [OTHER.toLowerCase()]: { [dave]: 1n } }) });
    const record = result.status === "built" ? result.record : undefined!;
    assert.deepEqual(record.leaves.map((l) => [l.account.toLowerCase(), l.amount]), [[dave, (2n * ETH).toString()]]);
    assert.deepEqual(await store.get(carryKey(OTHER)), { holders: "0", fund: (1n * ETH).toString() });
  });

  it("builds each epoch once, and in order", async () => {
    events.set(NFT, [swap()]);
    const first = await buildEpoch(store, 0, deps);
    assert.equal(first.status, "built");
    const again = await buildEpoch(store, 0, { ...deps, holdings: async () => { throw new Error("must not read again"); } });
    assert.equal(again.status, "exists");
    assert.deepEqual(await buildEpoch(store, 2, { ...deps, now: () => GENESIS + 3 * WEEK }), { status: "out_of_order", expected: 1 });
    assert.equal(await store.get(lastKey()), 0);
  });

  it("builds nothing when balances can't be read, and doesn't stay locked", async () => {
    events.set(NFT, [swap()]);
    await assert.rejects(buildEpoch(store, 0, { ...deps, holdings: async () => null }), /can't read/);
    assert.equal(await store.get(epochKey(0)), null);
    assert.equal((await buildEpoch(store, 0, deps)).status, "built");
  });

  it("serves an account's leaves and a Club's view", async () => {
    events.set(NFT, [swap()]);
    await buildEpoch(store, 0, deps);
    const mine = await claimableFor(store, getAddress(alice));
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.epoch, 0);
    assert.deepEqual(mine[0]!.breakdown.map((b) => b.kind).sort(), ["fund", "holder"]);
    assert.deepEqual(await claimableFor(store, getAddress(dave)), []);
    assert.deepEqual(await claimableFor(store, getAddress(carol)), [], "Bob holds only the coin");

    const view = await clubRewards(store, NFT);
    assert.equal(view.epochs.length, 1);
    assert.equal(view.epochs[0]!.fees, (4n * ETH).toString());
    assert.equal(view.earners[0]!.amount, (2n * ETH).toString());
    assert.deepEqual(view.carry, { holders: "0", fund: "0" });
  });
});

describe("cross-check with the contract", () => {
  it("matches the fixture DeClubRewards.leafFixture.t.sol verifies on chain", () => {
    // Chain 10143, the contract at REWARDS_AT, epoch 4: Alice 3 MON, Bob 2, Carol 1.
    const leaves = [
      rewardLeaf(10143, REWARDS_AT, 4, getAddress(alice), 3n * ETH),
      rewardLeaf(10143, REWARDS_AT, 4, getAddress(bob), 2n * ETH),
      rewardLeaf(10143, REWARDS_AT, 4, getAddress(carol), 1n * ETH),
    ];
    const tree = buildMerkleTree(leaves);
    assert.deepEqual({ root: tree.root, aliceProof: tree.proofs[0] }, FIXTURE);
  });
});

/** Pasted into contracts/test/rewards/DeClubRewards.leafFixture.t.sol. Rebuild both together. */
const FIXTURE = {
  root: "0x900ceb6b4bf39dfec8495853b364500f485ff7d96e81b0b3c48b73c3fe604c65" as Hex,
  aliceProof: [
    "0xe92b6142bb576190a191c0299f86454dfb840fdd2794ba9ba6442081a7f3e48f",
    "0x950740596a524f91871784f2ed481a395825a7eab84ee027be51e687c3ea095e",
  ] as Hex[],
};

describe("rewards routes", () => {
  const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
  const req = (path: string) => new Request(`http://localhost${path}`);
  let store: Store;

  beforeEach(async () => {
    store = memoryStore();
    await join(store, NFT, "ua", [alice]);
    await store.set(rolesKey(NFT), { owner: "ua", moderators: [] });
    await buildEpoch(store, 0, {
      now: () => GENESIS + WEEK,
      clubs,
      events: async (club) => (club.address === NFT ? [swap()] : []),
      holdings: holdingsOf({ [NFT.toLowerCase()]: { [alice]: 1n } }),
      chainId: 10143,
      contract: REWARDS_AT,
      genesis: GENESIS,
      length: WEEK,
      rules: () => ({ ...DEFAULT_CLUB_RULES, minPoints: 1 }),
    });
  });

  it("serves a built epoch, and 404s or 400s otherwise", async () => {
    const { epochHandler } = await import("../lib/server/rewardRoutes");
    const GET = epochHandler({ store: () => store });
    const ok = await GET(req("/api/rewards/epochs/0"), params({ n: "0" }));
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { n: number }).n, 0);
    assert.match(ok.headers.get("cache-control") ?? "", /immutable/);
    assert.equal((await GET(req("/api/rewards/epochs/1"), params({ n: "1" }))).status, 404);
    assert.equal((await GET(req("/api/rewards/epochs/x"), params({ n: "x" }))).status, 400);
    assert.equal((await epochHandler({ store: () => null })(req("/"), params({ n: "0" }))).status, 503);
  });

  it("serves an account's leaves, and says when rewards are off", async () => {
    const { claimableHandler } = await import("../lib/server/rewardRoutes");
    const res = await claimableHandler({ store: () => store })(req(`/api/rewards/me?account=${alice}`));
    const body = (await res.json()) as { enabled: boolean; leaves: { epoch: number; amount: string }[] };
    assert.equal(body.enabled, true);
    assert.deepEqual(body.leaves.map((l) => [l.epoch, l.amount]), [[0, (3n * ETH).toString()]]);
    assert.equal((await claimableHandler({ store: () => store })(req("/api/rewards/me?account=nope"))).status, 400);
    const off = (await (await claimableHandler({ store: () => null })(req(`/api/rewards/me?account=${alice}`))).json()) as { enabled: boolean };
    assert.equal(off.enabled, false);
  });

  it("serves a Club's view, and 404s for an address with no Club", async () => {
    const { clubRewardsHandler } = await import("../lib/server/rewardRoutes");
    const GET = clubRewardsHandler(makeRegistry(entries), { store: () => store });
    const body = (await (await GET(req("/"), params({ token: COIN }))).json()) as { enabled: boolean; epochs: unknown[] };
    assert.equal(body.enabled, true, "the memecoin's address serves its collection's Club");
    assert.equal(body.epochs.length, 1);
    assert.equal((await GET(req("/"), params({ token: REWARDS_AT }))).status, 404);
  });
});
