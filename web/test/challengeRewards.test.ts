import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, keccak256, numberToHex, pad, stringToHex, type Hex } from "viem";
import { CHALLENGE_RULES, assetText, checkChallenge, isPinned, prizeStatus, type PublicChallenge, type StoredChallenge } from "../lib/challenges";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { createPost, likePost, type Deps } from "../lib/server/board";
import { challengeHandlers } from "../lib/server/boardRoutes";
import { TRANSFER_TOPIC, prizeProblem, type PrizeChain, type PrizeReceipt } from "../lib/server/challengePrizes";
import {
  cancelChallenge,
  createChallenge,
  enterChallenge,
  getChallenge,
  pickWinners,
  sendPrize,
  settleDue,
  type BlockReader,
  type ChallengeDeps,
} from "../lib/server/challenges";
import { challengeKey, readAwards, readTrophies } from "../lib/server/challengeState";
import { readLog, saveRoles } from "../lib/server/clubState";
import type { UserGate } from "../lib/server/gate";
import { clubInbox } from "../lib/server/inbox";
import { joinClub, listMembers } from "../lib/server/members";
import { walletProfileHandler } from "../lib/server/profilePageRoutes";
import { memoryStore, type Store } from "../lib/server/store";
import { withoutPinned, type SystemEvent } from "../lib/systemFeed";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";
import type { XCard } from "../lib/xPosts";

/** Rewards beyond points (ADR 0050): trophies, an asset prize the Owner sends, pinned results. */

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const OTHER_NFT = getAddress("0x00000000000000000000000000000000000a0721");
const USDC = getAddress("0x00000000000000000000000000000000000a0020");
const FAKE = getAddress("0x00000000000000000000000000000000000bad00");
const reg = makeRegistry(
  parseAssets([
    { chainId: 10143, address: NFT, kind: "erc721", name: "Chogs", symbol: "CHOG", status: "verified", note: "Why." },
    { chainId: 10143, address: OTHER_NFT, kind: "erc721", name: "Moles", symbol: "MOLE", status: "verified", note: "Why." },
    { chainId: 10143, address: USDC, kind: "erc20", category: "stablecoin", name: "USD Coin", symbol: "USDC", status: "verified", note: "Why." },
    { chainId: 10143, address: FAKE, kind: "erc20", category: "other", name: "USD Coin", symbol: "USDC", status: "blocked", note: "A copy." },
  ]),
);
const club = reg.clubFor(NFT)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const GENESIS = 1_700_000_000;
const WEEK = 7 * 86_400;
const DAY_MS = 86_400_000;
const START = 10;
const END = WEEK;
const tweets = new Map<string, XCard>();

/** A fake chain: the receipts by hash, and USDC's 6 decimals. */
function fakeChain(decimals: number | null = 6) {
  const receipts = new Map<string, PrizeReceipt>();
  const state = { down: false, decimalReads: 0 };
  const chain: PrizeChain = {
    async decimals() {
      state.decimalReads++;
      return decimals;
    },
    async receipt(tx) {
      if (state.down) throw new Error("rpc down");
      return receipts.get(tx.toLowerCase()) ?? null;
    },
  };
  return { chain, receipts, state };
}
const shared = fakeChain();

const at = (s: number, prizeChain: PrizeChain = shared.chain): ChallengeDeps => ({
  now: () => (GENESIS + s) * 1000,
  epochs: { genesis: GENESIS, length: WEEK },
  admins: new Set(["adm"]),
  lookupX: async (id) => tweets.get(id) ?? null,
  xAccountOf: async (userId) => ({ username: userId, subject: userId }),
  registry: reg,
  prizeChain,
});
const actor = (userId: string, n: number) => ({ userId, wallet: wallet(n) });

/** `userId` joins with wallet `n` (and, for "g", a second linked wallet 0x…33). */
async function member(store: Store, userId: string, n: number) {
  const ws = userId === "g" ? [wallet(n), wallet(0x33)] : [wallet(n)];
  await store.set(profileKey(wallet(n)), { provider: "twitter", handle: `h${n}`, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [wallet(n)]);
  assert.ok((await joinClub(store, club, userId, ws, { holdings: async () => ws.map(() => 0n) })).ok);
}
let tweetId = 50_000;
async function post(store: Store, userId: string, s: number) {
  await store.del(`declub:rl:club-post-cd:${token}:${userId}`, `declub:rl:club-post-hr:${token}:${userId}`);
  const id = String(tweetId++);
  tweets.set(id, { id, author: userId, text: `entry ${s}`, postedAt: (GENESIS + s) * 1000 });
  const r = await createPost(store, club, userId, { kind: "note", text: `gm ${userId} ${s}`, link: `https://x.com/${userId}/status/${id}` }, at(s) as Deps);
  assert.ok(r.ok);
  return r.post.id;
}
/** An Owner (1), a Moderator (2), members g (3), a (4) and x (5). */
async function world() {
  const store = memoryStore();
  for (const [u, n] of [
    ["own", 1],
    ["mod", 2],
    ["g", 3],
    ["a", 4],
    ["x", 5],
  ] as const)
    await member(store, u, n);
  await saveRoles(store, token, { owner: "own", moderators: ["mod"] });
  return store;
}
const ranked = (over: Record<string, unknown> = {}) => ({
  title: "Best Chog meme",
  brief: "Post your funniest Chog.",
  judging: "likes",
  prizes: [10, 5],
  epochs: 1,
  ...over,
});
const flat = (judging: string, over: Record<string, unknown> = {}) => ({
  title: "Giveaway",
  brief: "Post a Chog.",
  judging,
  winners: 2,
  prize: 3,
  epochs: 1,
  ...over,
});

async function start(store: Store, input: Record<string, unknown>, deps = at(START)) {
  const r = await createChallenge(store, club, actor("own", 1), input, deps);
  assert.ok(r.ok, JSON.stringify(r));
  return r.id;
}
/** g enters at 60 s with 2 likes, a at 61 s with 1, x at 62 s with none. */
async function played(store: Store, id: string) {
  const posts = { g: await post(store, "g", 60), a: await post(store, "a", 61), x: await post(store, "x", 62) };
  for (const u of ["g", "a", "x"] as const) assert.ok((await enterChallenge(store, club, u, id, posts[u], at(63))).ok, u);
  for (const [who, p] of [
    ["a", posts.g],
    ["x", posts.g],
    ["g", posts.a],
  ] as const)
    assert.ok((await likePost(store, club, who, p, true, at(100) as Deps)).ok);
  return posts;
}

const erc20Log = (asset: string, to: string, value: bigint) => ({
  address: asset,
  topics: [TRANSFER_TOPIC, pad(wallet(1) as Hex), pad(to as Hex)] as Hex[],
  data: numberToHex(value, { size: 32 }),
});
const nftLog = (asset: string, to: string, id: bigint) => ({
  address: asset,
  topics: [TRANSFER_TOPIC, pad(wallet(1) as Hex), pad(to as Hex), numberToHex(id, { size: 32 })] as Hex[],
  data: "0x" as Hex,
});
const receipt = (logs: PrizeReceipt["logs"], s = END + 100, status: PrizeReceipt["status"] = "success"): PrizeReceipt => ({ status, at: GENESIS + s, logs });
const txHash = (label: string) => keccak256(stringToHex(label));

describe("an asset prize, checked", () => {
  const ctx = { registry: reg, decimals: (t: string) => (t.toLowerCase() === USDC.toLowerCase() ? 6 : null) };
  const check = (over: Record<string, unknown>, input = ranked) => checkChallenge(input(over), ctx);

  it("takes a verified NFT or token, one amount per place, never more for a lower place", () => {
    const nft = check({ rewards: { asset: { token: OTHER_NFT, amounts: [2, "1"] } } });
    assert.ok(nft.ok);
    assert.deepEqual(nft.challenge.rewards, { asset: { token: OTHER_NFT.toLowerCase(), kind: "erc721", name: "Moles", symbol: "MOLE", amounts: ["2", "1"] } });
    const usdc = check({ rewards: { asset: { token: USDC, amounts: ["2.5", "0"] }, pinWinner: true } });
    assert.ok(usdc.ok);
    assert.deepEqual(usdc.challenge.rewards, {
      pinWinner: true,
      asset: { token: USDC.toLowerCase(), kind: "erc20", name: "USD Coin", symbol: "USDC", decimals: 6, amounts: ["2500000", "0"] },
    });
    assert.equal(assetText(usdc.challenge.rewards!.asset!, "2500000"), "2.5 USDC");
    assert.equal(assetText(nft.challenge.rewards!.asset!, "1"), "1 NFT from Moles");
    // Old inputs, and pinning alone, still check.
    const none = check({});
    assert.ok(none.ok);
    assert.equal(none.challenge.rewards, undefined);
    assert.deepEqual((check({ rewards: { pinWinner: true } }) as { challenge: { rewards: unknown } }).challenge.rewards, { pinWinner: true });

    const bad = (over: Record<string, unknown>, why: RegExp, input = ranked) => {
      const r = check(over, input);
      assert.equal(r.ok, false, JSON.stringify(over));
      assert.match((r as { message: string }).message, why);
    };
    bad({ rewards: { asset: { token: FAKE, amounts: [1, 1] } } }, /verified list/);
    bad({ rewards: { asset: { token: getAddress(wallet(0x77)), amounts: [1, 1] } } }, /verified list/);
    bad({ rewards: { asset: { token: "nope", amounts: [1, 1] } } }, /Choose/);
    bad({ rewards: { asset: { token: OTHER_NFT, amounts: [1, 2] } } }, /lower place/);
    bad({ rewards: { asset: { token: USDC, amounts: ["1", "1.5"] } } }, /lower place/);
    bad({ rewards: { asset: { token: OTHER_NFT, amounts: [1] } } }, /each paid place/);
    bad({ rewards: { asset: { token: OTHER_NFT, amounts: [0, 0] } } }, /more than 0/);
    bad({ rewards: { asset: { token: OTHER_NFT, amounts: [CHALLENGE_RULES.maxPrizeNfts + 1, 1] } } }, /whole number of NFTs/);
    bad({ rewards: { asset: { token: OTHER_NFT, amounts: [1.5, 1] } } }, /whole number of NFTs/);
    bad({ rewards: { asset: { token: USDC, amounts: ["1.0000001", "0"] } } }, /6 decimals/);
    bad({ rewards: { asset: { token: USDC, amounts: [String(CHALLENGE_RULES.maxPrizeTokens + 1), "0"] } } }, /USDC/);
    bad({ rewards: { asset: { token: USDC, amounts: ["-1", "0"] } } }, /USDC/);
    bad({ rewards: { pinWinner: "yes" } }, /pinWinner/);
    bad({ rewards: [] }, /object/);
  });

  it("needs the token's own decimals: none known, no prize", () => {
    const r = checkChallenge(ranked({ rewards: { asset: { token: USDC, amounts: ["1", "0"] } } }), { registry: reg });
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /decimals/);
    // The same "1" is a different amount at 18 decimals: the decimals are the token's, never assumed.
    const at18 = checkChallenge(ranked({ rewards: { asset: { token: USDC, amounts: ["1", "0"] } } }), { registry: reg, decimals: () => 18 });
    assert.ok(at18.ok);
    assert.equal(at18.challenge.rewards!.asset!.amounts[0], (10n ** 18n).toString());
  });

  it("gives a flat prize one amount, what each winner gets", () => {
    const r = checkChallenge(flat("raffle", { rewards: { asset: { token: USDC, amounts: ["5"] } } }), ctx);
    assert.ok(r.ok);
    assert.deepEqual(r.challenge.rewards!.asset!.amounts, ["5000000"]);
    assert.equal(checkChallenge(flat("first", { rewards: { asset: { token: USDC, amounts: ["5", "5"] } } }), ctx).ok, false);
    assert.equal(checkChallenge(flat("everyone", { rewards: { asset: { token: OTHER_NFT, amounts: [0] } } }), ctx).ok, false);
  });

  it("is checked on the server with decimals read from the contract, not sent by the form", async () => {
    const store = await world();
    const chain = fakeChain(6);
    const id = await start(store, ranked({ rewards: { asset: { token: USDC, amounts: ["2", "1"] } } }), at(START, chain.chain));
    assert.equal(chain.state.decimalReads, 1);
    const stored = (await store.get<StoredChallenge>(challengeKey(token, id)))!;
    assert.deepEqual(stored.rewards!.asset!.amounts, ["2000000", "1000000"]);
    const log = (await readLog(store, token)).find((l) => l.action === "create_challenge")!;
    assert.match(log.detail ?? "", /plus 2 USDC\/1 USDC/);
    // A token that doesn't answer can't be a prize.
    const silent = fakeChain(null);
    const r = await createChallenge(
      store,
      club,
      actor("own", 1),
      ranked({ rewards: { asset: { token: USDC, amounts: ["2", "1"] } } }),
      at(START, silent.chain),
    );
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, "invalid");
  });
});

describe("trophies", () => {
  it("go to every winner once, ranked with a place, a 0-point win too, and stay out of the epoch's points", async () => {
    const store = await world();
    const id = await start(store, ranked({ prizes: [0, 0] }));
    const posts = await played(store, id);
    assert.equal(await settleDue(store, club, at(END + 5)), 1);
    assert.equal(await settleDue(store, club, at(END + 6)), 0);
    const g = await readTrophies(store, "g");
    assert.deepEqual(g, [{ club: token, challenge: id, title: "Best Chog meme", place: 1, at: (GENESIS + END + 5) * 1000, wallet: wallet(3) }]);
    assert.deepEqual(
      (await readTrophies(store, "a")).map((t) => t.place),
      [2],
    );
    assert.deepEqual(await readTrophies(store, "x"), [], "x had no likes");
    assert.deepEqual(await readAwards(store, token, 0), {}, "a trophy-only win adds nothing to the epoch");
    assert.ok(posts.g);
  });

  it("are given in every way of picking winners, with no place for a flat one, and never twice", async () => {
    const blocks: BlockReader = { latest: async () => 100n, hashOf: async () => keccak256(stringToHex("block")) };
    for (const judging of ["owner", "first", "everyone", "raffle"]) {
      const store = await world();
      const id = await start(store, judging === "owner" ? ranked({ judging, prizes: [5] }) : flat(judging));
      const posts = await played(store, id);
      if (judging === "owner") {
        assert.ok((await pickWinners(store, club, actor("own", 1), id, [posts.a], at(END + 5))).ok);
      } else {
        await settleDue(store, club, { ...at(END + 5), blocks });
        if (judging === "raffle") await settleDue(store, club, { ...at(END + 6), blocks });
      }
      const c = (await getChallenge(store, club, id, {}, at(END + 7)))!;
      assert.equal(c.phase, "settled", judging);
      const won = c.settled!.winners.length;
      assert.ok(won > 0, judging);
      const all = [...(await readTrophies(store, "g")), ...(await readTrophies(store, "a")), ...(await readTrophies(store, "x"))];
      assert.equal(all.length, won, `${judging}: one trophy per winner`);
      assert.ok(
        all.every((t) => t.place === (judging === "owner" ? 1 : null)),
        judging,
      );
      await settleDue(store, club, { ...at(END + 8), blocks });
      assert.equal(
        [...(await readTrophies(store, "g")), ...(await readTrophies(store, "a")), ...(await readTrophies(store, "x"))].length,
        won,
        `${judging}: once`,
      );
    }
  });

  it("aren't given for a cancelled challenge", async () => {
    const store = await world();
    const id = await start(store, ranked());
    await played(store, id);
    assert.ok((await cancelChallenge(store, club, actor("own", 1), id, at(200))).ok);
    await settleDue(store, club, at(END + 5));
    for (const u of ["g", "a", "x"]) assert.deepEqual(await readTrophies(store, u), []);
  });

  it("show on the winner's profile and member row, only under the wallet that won", async () => {
    const store = await world();
    const id = await start(store, ranked());
    await played(store, id);
    await settleDue(store, club, at(END + 5));
    const get = walletProfileHandler({ store: () => store, registry: reg });
    const ctx = (address: string) => ({ params: Promise.resolve({ address }) });
    const body = (await (await get(new Request("http://x"), ctx(wallet(3)))).json()) as { trophies?: unknown[] };
    assert.deepEqual(body.trophies, [{ club: token, challenge: id, title: "Best Chog meme", place: 1, at: (GENESIS + END + 5) * 1000, clubName: "Chogs" }]);
    // g's other linked wallet shows nothing: a profile never ties two wallets together.
    const other = (await (await get(new Request("http://x"), ctx(wallet(0x33)))).json()) as { trophies?: unknown[] };
    assert.equal(other.trophies, undefined);
    const nowMs = (GENESIS + END + 10) * 1000;
    const view = await listMembers(store, club, [], "new", Math.floor(nowMs / 1000), { now: () => nowMs, holdings: async (_t, ws) => ws.map(() => 0n) });
    const rows = new Map(view.members.map((m) => [m.wallet, m.trophies]));
    assert.deepEqual(rows.get(wallet(3)), [{ challenge: id, title: "Best Chog meme", place: 1 }]);
    assert.deepEqual(rows.get(wallet(4)), [{ challenge: id, title: "Best Chog meme", place: 2 }]);
    assert.equal(rows.get(wallet(5)), undefined);
  });
});

describe("an asset prize, owed and sent", () => {
  /** A likes challenge paying 2 then 1 USDC (6 decimals), played and settled at END + 5. */
  async function owed(asset: { token: string; amounts: unknown[] } = { token: USDC, amounts: ["2", "1"] }, rewards: Record<string, unknown> = {}) {
    const store = await world();
    const fake = fakeChain(6);
    const id = await start(store, ranked({ rewards: { asset, ...rewards } }), at(START, fake.chain));
    const posts = await played(store, id);
    await settleDue(store, club, at(END + 5, fake.chain));
    return { store, id, posts, fake };
  }

  it("is owed to each winner from the settle, outside the epoch's points", async () => {
    const { store, id, posts } = await owed();
    const c = (await getChallenge(store, club, id, {}, at(END + 6)))!;
    assert.deepEqual(
      c.settled!.winners.map((w) => [w.post, w.prize, w.sent]),
      [
        [posts.g, "2000000", undefined],
        [posts.a, "1000000", undefined],
      ],
    );
    assert.equal(c.prizeDueBy, (GENESIS + END + 5) * 1000 + CHALLENGE_RULES.prizeDueMs);
    assert.equal(JSON.stringify(c).includes("prizeUsers"), false, "user ids never leave the server");
    assert.deepEqual(
      Object.values(await readAwards(store, token, 0))
        .map((x) => x.points)
        .sort(),
      [10, 5],
      "the points are unchanged",
    );
    assert.equal(prizeStatus(c.settled!.winners[0]!, c.settled!.at, c.settled!.at + 1), "owed");
    assert.equal(prizeStatus(c.settled!.winners[0]!, c.settled!.at, c.settled!.at + CHALLENGE_RULES.prizeDueMs), "overdue");
  });

  it("is marked sent only by a transaction that pays it, checked on chain", async () => {
    const { store, id, posts, fake } = await owed();
    const send = (tx: Hex, post = posts.g, who = actor("own", 1), s = END + 200) => sendPrize(store, club, who, id, { post, tx }, at(s, fake.chain));
    const usdc = USDC.toLowerCase();
    const cases: [string, PrizeReceipt | null, string][] = [
      ["missing", null, "tx_not_found"],
      ["reverted", receipt([erc20Log(usdc, wallet(3), 2_000_000n)], END + 100, "reverted"), "tx_failed"],
      ["too early", receipt([erc20Log(usdc, wallet(3), 2_000_000n)], END + 1), "tx_too_early"],
      ["wrong asset", receipt([erc20Log(OTHER_NFT.toLowerCase(), wallet(3), 2_000_000n)]), "wrong_asset"],
      ["an NFT transfer of the token's address", receipt([nftLog(usdc, wallet(3), 2_000_000n)]), "wrong_asset"],
      ["wrong recipient", receipt([erc20Log(usdc, wallet(4), 2_000_000n)]), "wrong_recipient"],
      ["too little", receipt([erc20Log(usdc, wallet(3), 1_999_999n)]), "too_little"],
    ];
    for (const [label, r, reason] of cases) {
      const tx = txHash(label);
      if (r) fake.receipts.set(tx, r);
      assert.deepEqual(await send(tx), { ok: false, reason }, label);
    }
    fake.state.down = true;
    assert.deepEqual(await send(txHash("too little")), { ok: false, reason: "chain_unavailable" });
    fake.state.down = false;
    assert.deepEqual(await send(txHash("x"), posts.g, actor("g", 3)), { ok: false, reason: "forbidden" });
    assert.deepEqual(await send(txHash("x"), posts.x), { ok: false, reason: "no_prize" }, "x didn't win");
    assert.equal((await send("0x12" as Hex)).ok, false);

    // Two transfers to two of g's linked wallets add up: any wallet g linked counts.
    const good = txHash("good");
    fake.receipts.set(good, receipt([erc20Log(usdc, wallet(3), 1_500_000n), erc20Log(usdc, wallet(0x33), 500_000n)]));
    const ok = await send(good);
    assert.ok(ok.ok);
    const c = (await getChallenge(store, club, id, {}, at(END + 300)))!;
    assert.deepEqual(c.settled!.winners[0]!.sent, { tx: good, at: (GENESIS + END + 200) * 1000 });
    assert.ok((await readLog(store, token)).some((l) => l.action === "prize_sent" && l.target === id));
    assert.deepEqual(await send(good), { ok: false, reason: "prize_sent" });
    // The same transaction can't pay a second prize, even one it would cover.
    fake.receipts.set(good, receipt([erc20Log(usdc, wallet(3), 2_000_000n), erc20Log(usdc, wallet(4), 1_000_000n)]));
    assert.deepEqual(await send(good, posts.a), { ok: false, reason: "tx_used" });
    const second = txHash("second");
    fake.receipts.set(second, receipt([erc20Log(usdc, wallet(4), 1_000_000n)]));
    assert.ok((await send(second, posts.a, actor("adm", 9))).ok, "an app admin can mark it too");
  });

  it("counts an NFT prize by the distinct NFTs sent to the winner", async () => {
    const { store, id, posts, fake } = await owed({ token: OTHER_NFT, amounts: [2, 1] });
    const mole = OTHER_NFT.toLowerCase();
    const one = txHash("one");
    fake.receipts.set(one, receipt([nftLog(mole, wallet(3), 7n), nftLog(mole, wallet(3), 7n)]));
    assert.deepEqual(await sendPrize(store, club, actor("own", 1), id, { post: posts.g, tx: one }, at(END + 200, fake.chain)), {
      ok: false,
      reason: "too_little",
    });
    const two = txHash("two");
    fake.receipts.set(two, receipt([nftLog(mole, wallet(3), 7n), nftLog(mole, wallet(0x33), 8n)]));
    assert.ok((await sendPrize(store, club, actor("own", 1), id, { post: posts.g, tx: two }, at(END + 200, fake.chain))).ok);
    assert.equal(prizeProblem(receipt([nftLog(mole, wallet(3), 1n)]), { token: mole, kind: "erc721" }, "1", new Set([wallet(3)]), 0), null);
  });

  it("goes through the challenge route", async () => {
    const { store, id, posts, fake } = await owed();
    const tx = txHash("route");
    fake.receipts.set(tx, receipt([erc20Log(USDC.toLowerCase(), wallet(3), 2_000_000n)]));
    const gate = async () =>
      ({ store, user: { id: "own", linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: wallet(1) }] } }) as unknown as UserGate;
    const routes = challengeHandlers(reg, { ...at(END + 200, fake.chain), gate });
    const ctx = { params: Promise.resolve({ token: NFT, id }) };
    const res = await routes.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action: "prize_sent", post: posts.g, tx }) }), ctx);
    assert.equal(res.status, 200, await res.clone().text());
    const again = await routes.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action: "prize_sent", post: posts.g, tx }) }), ctx);
    assert.equal(again.status, 409);
    assert.equal(((await again.json()) as { error: string }).error, "prize_sent");
  });

  it("is overdue after the due time, and an Owner who owes one can't offer another asset prize", async () => {
    const { store, id, posts, fake } = await owed();
    const late = END + 5 + CHALLENGE_RULES.prizeDueMs / 1000;
    const c = (await getChallenge(store, club, id, {}, at(late)))!;
    assert.equal(prizeStatus(c.settled!.winners[0]!, c.settled!.at, (GENESIS + late) * 1000), "overdue");
    const asset = { rewards: { asset: { token: USDC, amounts: ["1", "0"] } } };
    const refused = await createChallenge(store, club, actor("own", 1), ranked(asset), at(late, fake.chain));
    assert.deepEqual(refused, { ok: false, reason: "prize_overdue" });
    assert.equal(
      (await createChallenge(store, club, actor("own", 1), ranked({ ...asset, epochs: 2 }), at(late - 10, fake.chain))).ok,
      true,
      "before the due time it's only owed",
    );
    assert.ok((await createChallenge(store, club, actor("own", 1), ranked(), at(late, fake.chain))).ok, "a points-only challenge is still fine");
    // Paying both (late is fine) lifts the block.
    for (const [p, to, amount] of [
      [posts.g, wallet(3), 2_000_000n],
      [posts.a, wallet(4), 1_000_000n],
    ] as const) {
      const tx = txHash(`late ${p}`);
      fake.receipts.set(tx, receipt([erc20Log(USDC.toLowerCase(), to, amount)], late + 1));
      assert.ok((await sendPrize(store, club, actor("own", 1), id, { post: p, tx }, at(late + 2, fake.chain))).ok);
    }
    assert.ok((await createChallenge(store, club, actor("own", 1), ranked(asset), at(late + 3, fake.chain))).ok);
  });

  it("is news: the Owner is asked while it's owed, again once overdue, and the winner hears when it's sent", async () => {
    const { store, id, posts, fake } = await owed();
    const settledAt = (GENESIS + END + 5) * 1000;
    const inbox = async (userId: string, n: number, nowMs: number) =>
      (await clubInbox(store, userId, [wallet(n)], { registry: reg, standings: async () => null, admins: new Set(["adm"]), now: () => nowMs })).filter((i) =>
        i.kind.startsWith("challenge-prize"),
      );
    const [ask] = await inbox("own", 1, settledAt + DAY_MS);
    assert.deepEqual(
      [ask!.kind, ask!.key, ask!.actionable, ask!.href],
      ["challenge-prize-owed", `challenge-prize-owed:${token}:${id}`, true, `/clubs/${token}/challenges/${id}`],
    );
    assert.match(ask!.title, /Send the prizes for “Best Chog meme”/);
    assert.deepEqual(await inbox("g", 3, settledAt + DAY_MS), [], "nothing sent yet");
    const [overdue] = await inbox("own", 1, settledAt + CHALLENGE_RULES.prizeDueMs);
    assert.equal(overdue!.key, `challenge-prize-owed:${token}:${id}:overdue`);
    assert.match(overdue!.body, /overdue/);

    const tx = txHash("news");
    fake.receipts.set(tx, receipt([erc20Log(USDC.toLowerCase(), wallet(3), 2_000_000n)]));
    assert.ok((await sendPrize(store, club, actor("own", 1), id, { post: posts.g, tx }, at(END + 200, fake.chain))).ok);
    const [sent] = await inbox("g", 3, settledAt + DAY_MS);
    assert.deepEqual([sent!.kind, sent!.key, sent!.actionable], ["challenge-prize-sent", `challenge-prize-sent:${token}:${id}`, undefined]);
    assert.match(sent!.body, /^2 USDC from the Owner/);
    const [still] = await inbox("own", 1, settledAt + DAY_MS);
    assert.match(still!.title, /Send the prize for/, "one left to send");
    assert.deepEqual(await inbox("a", 4, settledAt + DAY_MS), [], "a's isn't sent yet");
    assert.deepEqual(await inbox("x", 5, settledAt + DAY_MS), []);
  });
});

describe("pinned results", () => {
  it("stay on top of the Board for the pin window, only when the Owner asked and someone won", async () => {
    const store = await world();
    const pinned = await start(store, ranked({ rewards: { pinWinner: true } }));
    const plain = await start(store, ranked({ title: "Plain" }));
    await played(store, pinned);
    const settledAt = (GENESIS + END + 5) * 1000;
    await settleDue(store, club, at(END + 5));
    const c = (await getChallenge(store, club, pinned, {}, at(END + 6)))!;
    assert.equal(c.pinUntil, settledAt + CHALLENGE_RULES.pinResultsMs);
    assert.ok(isPinned(c, settledAt + 1));
    assert.ok(!isPinned(c, settledAt + CHALLENGE_RULES.pinResultsMs));
    const p = (await getChallenge(store, club, plain, {}, at(END + 6)))!;
    assert.equal(p.pinUntil, undefined, "not asked for");
    assert.ok(!isPinned(p, settledAt + 1));
    assert.ok(isPinned({ phase: "open" } as PublicChallenge, 0), "a running challenge is always pinned");

    // Nobody won: nothing to pin.
    const empty = await start(store, ranked({ rewards: { pinWinner: true }, epochs: 2 }), at(END + 10));
    await settleDue(store, club, at(2 * END + 5));
    assert.equal((await getChallenge(store, club, empty, {}, at(2 * END + 6)))!.pinUntil, undefined);
  });

  it("leave both the start and the result out of the feed while pinned", () => {
    const ev = (id: string, kind: SystemEvent["kind"], challenge: string) => ({ id, kind, challenge, at: 1, clubs: [token] }) as unknown as SystemEvent;
    const events = [ev("s:a", "challenge", "a"), ev("w:a", "winner", "a"), ev("s:b", "challenge", "b"), ev("w:b", "winner", "b")];
    assert.deepEqual(
      withoutPinned(events, new Set(["a", "b"]), new Set(["b"])).map((e) => e.id),
      ["w:a"],
    );
  });
});
