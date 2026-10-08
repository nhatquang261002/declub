import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHALLENGE_RULES, type StoredChallenge } from "../lib/challenges";
import { clubNotifications } from "../lib/notifications";
import { challengeKey, challengesKey, entriesKey } from "../lib/server/challengeState";
import { saveRoles } from "../lib/server/clubState";
import { rewardBansKey } from "../lib/server/clubRules";
import { clubInbox, type InboxDeps } from "../lib/server/inbox";
import { joinClub } from "../lib/server/members";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

/** Challenge notifications in the Club inbox (ADR 0045), read straight from stored challenges. */

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const reg = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "Chogs", symbol: "N", status: "verified", note: "Why." }]));
const club = reg.clubFor(NFT)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/** An Owner ("own"), a Moderator ("mod"), members "m1" (a Holder) and "m2", and an app admin ("adm"), all joined. */
async function world() {
  const store = memoryStore();
  for (const [u, n, holder] of [["own", 1, false], ["mod", 2, false], ["m1", 3, true], ["m2", 4, false], ["adm", 9, false]] as const) {
    assert.ok((await joinClub(store, club, u, [wallet(n)], { holdings: async () => [holder ? 1n : 0n] })).ok);
  }
  await saveRoles(store, token, { owner: "own", moderators: ["mod"] });
  return store;
}
const deps = (now = NOW): InboxDeps => ({ registry: reg, standings: async () => null, admins: new Set(["adm"]), now: () => now });
const inbox = async (store: Store, userId: string, n: number, now = NOW) =>
  (await clubInbox(store, userId, [wallet(n)], deps(now))).filter((i) => i.kind.startsWith("challenge-"));

let seq = 0;
async function challenge(store: Store, over: Partial<StoredChallenge> = {}) {
  const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const c: StoredChallenge = { id, title: "Best Chog meme", brief: "Post your funniest Chog.", judging: "likes", prizes: [10, 5], startsAt: NOW - DAY, endsAt: NOW + 3 * DAY, by: wallet(1), state: "live", ...over };
  await store.set(challengeKey(token, id), c);
  await store.rank(challengesKey(token), [{ member: id, score: c.startsAt }], CHALLENGE_RULES.kept);
  return c;
}
const enter = (store: Store, c: StoredChallenge, userId: string, post = `p-${userId}`) => store.addMember(entriesKey(token, c.id), `${post}|${userId}`);

describe("challenge notifications", () => {
  it("tells members who can enter about a new challenge, keyed by the challenge, with its page as the link", async () => {
    const store = await world();
    const c = await challenge(store);
    const [item, ...rest] = await inbox(store, "m2", 4);
    assert.equal(rest.length, 0);
    assert.equal(item!.kind, "challenge-new");
    assert.equal(item!.key, `challenge-new:${token}:${c.id}`);
    assert.equal(item!.title, "New challenge in Chogs: “Best Chog meme”");
    assert.equal(item!.href, `/clubs/${token}/challenges/${c.id}`);
    assert.equal(item!.actionable, undefined);
    assert.deepEqual((await inbox(store, "mod", 2)).map((i) => i.kind), ["challenge-new"], "Moderators can enter");
    assert.deepEqual((await inbox(store, "m2", 4, NOW + 3_600_000)).map((i) => i.key), [item!.key], "the key doesn't move with the clock");
  });

  it("says nothing to the Owner or an admin about their own challenge, nor after entering", async () => {
    const store = await world();
    const c = await challenge(store);
    assert.deepEqual(await inbox(store, "own", 1), []);
    assert.deepEqual(await inbox(store, "adm", 9), []);
    await enter(store, c, "m2");
    assert.deepEqual(await inbox(store, "m2", 4), []);
  });

  it("leaves out a challenge started over two weeks ago, a Holders-only one for non-Holders, and members banned from rewards", async () => {
    const store = await world();
    await challenge(store, { startsAt: NOW - 15 * DAY, endsAt: NOW + 10 * DAY });
    assert.deepEqual(await inbox(store, "m2", 4), [], "old news");
    const h = await challenge(store, { holdersOnly: true });
    assert.deepEqual(await inbox(store, "m2", 4), [], "m2 has no Holder badge");
    const [forHolder] = await inbox(store, "m1", 3);
    assert.equal(forHolder!.key, `challenge-new:${token}:${h.id}`);
    assert.match(forHolder!.body, /^For Holders\./);
    await store.set(rewardBansKey(token), { m1: { wallet: wallet(3), at: 1, by: wallet(1) } });
    assert.deepEqual((await inbox(store, "m1", 3)).filter((i) => i.key.includes(h.id)), []);
  });

  it("nudges in the last day if not entered, once, then not after entering", async () => {
    const store = await world();
    const c = await challenge(store, { endsAt: NOW + 5 * 3_600_000 });
    const [ending, ...rest] = await inbox(store, "m2", 4);
    assert.equal(rest.length, 0, "the nudge replaces the new-challenge item");
    assert.equal(ending!.kind, "challenge-ending");
    assert.equal(ending!.key, `challenge-ending:${token}:${c.id}`);
    assert.match(ending!.title, /ends in 5h$/);
    assert.equal((await inbox(store, "m2", 4, NOW + 3_600_000))[0]!.key, ending!.key, "same key an hour later");
    assert.deepEqual(await inbox(store, "own", 1), [], "not for the Owner");
    await enter(store, c, "m2");
    assert.deepEqual(await inbox(store, "m2", 4), []);
  });

  it("tells a winner their place and points, and other entrants that the results are in", async () => {
    const store = await world();
    const c = await challenge(store, {
      endsAt: NOW - 2 * DAY,
      state: "settled",
      settled: { at: NOW - DAY, epoch: 3, winners: [{ post: "p-m1", wallet: wallet(3), place: 2, points: 5 }] },
    });
    await enter(store, c, "m1");
    await enter(store, c, "m2");
    const [won] = await inbox(store, "m1", 3);
    assert.equal(won!.kind, "challenge-won");
    assert.equal(won!.key, `challenge-won:${token}:${c.id}`);
    assert.equal(won!.title, "You won 2nd place in “Best Chog meme”");
    assert.equal(won!.body, "+5 points toward your rewards in Chogs.");
    const [results] = await inbox(store, "m2", 4);
    assert.equal(results!.kind, "challenge-results");
    assert.equal(results!.key, `challenge-results:${token}:${c.id}`);
    assert.match(results!.title, /^Results are in/);
    assert.deepEqual(await inbox(store, "mod", 2), [], "nothing for a member who didn't enter");
    assert.deepEqual(await inbox(store, "m1", 3, NOW + 15 * DAY), [], "forgotten after two weeks");
  });

  it("finds a win by the entry when the winning wallet was unlinked, and words an unranked win without a place", async () => {
    const store = await world();
    const c = await challenge(store, {
      judging: "raffle" as StoredChallenge["judging"],
      endsAt: NOW - 2 * DAY,
      state: "settled",
      settled: { at: NOW - DAY, epoch: 3, winners: [{ post: "p-m2", wallet: wallet(77), place: 1, points: 4 }] },
    });
    await enter(store, c, "m2");
    const [won] = await inbox(store, "m2", 4);
    assert.equal(won!.title, "You’re a winner of “Best Chog meme”");
  });

  it("asks only the Owner or an admin to pick an Owner-judged challenge's winners, then reminds them before the window ends", async () => {
    const store = await world();
    const c = await challenge(store, { judging: "owner", endsAt: NOW - DAY });
    assert.deepEqual(await inbox(store, "own", 1), [], "no entries, nothing to pick");
    await enter(store, c, "m1");
    const [pick] = await inbox(store, "own", 1);
    assert.equal(pick!.kind, "challenge-pick");
    assert.equal(pick!.key, `challenge-pick:${token}:${c.id}`);
    assert.equal(pick!.title, "Pick the winners of “Best Chog meme”");
    assert.equal(pick!.actionable, true);
    assert.equal(clubNotifications([pick!])[0]!.actionable, true, "the bell shows it as needing them");
    assert.deepEqual((await inbox(store, "adm", 9)).map((i) => i.kind), ["challenge-pick"]);
    for (const [u, n] of [["mod", 2], ["m1", 3], ["m2", 4]] as const) assert.deepEqual(await inbox(store, u, n), [], `not for ${u}`);

    const late = c.endsAt + CHALLENGE_RULES.pickWindowMs - 2 * DAY;
    const [soon, ...rest] = await inbox(store, "own", 1, late);
    assert.equal(rest.length, 0, "the reminder replaces the ask");
    assert.equal(soon!.kind, "challenge-pick-soon");
    assert.equal(soon!.key, `challenge-pick-soon:${token}:${c.id}`);
    assert.match(soon!.body, /^2 days left to pick in Chogs\. Without a pick it ends with no winners\.$/);
    assert.equal(soon!.actionable, true);
    assert.equal((await inbox(store, "own", 1, late + 3_600_000))[0]!.key, soon!.key, "same key later");
    assert.deepEqual(await inbox(store, "mod", 2, late), []);
    assert.deepEqual(await inbox(store, "own", 1, c.endsAt + CHALLENGE_RULES.pickWindowMs), [], "past the window there is nothing to pick");
  });

  it("asks the Owner to send an owed asset prize, even after two weeks, and tells the winner once it's sent (ADR 0050)", async () => {
    const store = await world();
    const asset = { token: "0x" + "ab".repeat(20), kind: "erc721" as const, name: "Moles", symbol: "MOLE", amounts: ["1"] };
    const c = await challenge(store, {
      endsAt: NOW - 2 * DAY,
      state: "settled",
      rewards: { asset },
      settled: { at: NOW - DAY, winners: [{ post: "p-m1", wallet: wallet(3), place: 1, points: 0, prize: "1" }] },
    });
    await enter(store, c, "m1");
    const [won] = await inbox(store, "m1", 3);
    assert.equal(won!.kind, "challenge-won");
    assert.equal(won!.body, "See the results in Chogs. The Owner sends you 1 NFT from Moles.");
    const [owed] = await inbox(store, "own", 1);
    assert.deepEqual([owed!.kind, owed!.key, owed!.actionable], ["challenge-prize-owed", `challenge-prize-owed:${token}:${c.id}`, true]);
    assert.equal(owed!.title, "Send the prize for “Best Chog meme”");
    assert.equal(clubNotifications([owed!])[0]!.actionable, true, "the bell shows it as needing them");
    assert.deepEqual((await inbox(store, "adm", 9)).map((i) => i.kind), ["challenge-prize-owed"]);
    assert.deepEqual(await inbox(store, "mod", 2), [], "not a Moderator's to send");
    const later = await inbox(store, "own", 1, NOW + 20 * DAY);
    assert.deepEqual(later.map((i) => i.key), [`challenge-prize-owed:${token}:${c.id}:overdue`], "still asked, as news again, once overdue");

    await store.set(challengeKey(token, c.id), { ...c, settled: { ...c.settled!, winners: [{ ...c.settled!.winners[0]!, sent: { tx: "0x" + "1".repeat(64), at: NOW } }] } });
    assert.deepEqual(await inbox(store, "own", 1), [], "nothing left to send");
    const sent = (await inbox(store, "m1", 3)).find((i) => i.kind === "challenge-prize-sent")!;
    assert.equal(sent.key, `challenge-prize-sent:${token}:${c.id}`);
    assert.equal(sent.title, "Your prize for “Best Chog meme” was sent");
    assert.equal(clubNotifications([sent])[0]!.actionable, false);
  });

  it("asks nobody to pick a likes-judged challenge, and says nothing at all of a cancelled one", async () => {
    const store = await world();
    const likes = await challenge(store, { endsAt: NOW - DAY });
    await enter(store, likes, "m1");
    assert.deepEqual(await inbox(store, "own", 1), []);
    const open = await challenge(store, { state: "cancelled" });
    const ended = await challenge(store, { judging: "owner", endsAt: NOW - DAY, state: "cancelled" });
    await enter(store, open, "m1");
    await enter(store, ended, "m1");
    for (const [u, n] of [["own", 1], ["m1", 3], ["m2", 4]] as const) assert.deepEqual(await inbox(store, u, n), [], `nothing for ${u}`);
  });
});
