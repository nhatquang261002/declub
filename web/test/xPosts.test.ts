import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { checkProfileEdit, linkFor, parseLink } from "../lib/clubPosts";
import type { ActivityEvent } from "../lib/clubs";
import { MOMENTUM, memberScore, score } from "../lib/momentum";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { REWARDS, activityPoints, bonusBps, splitClub, type ReachRecord } from "../lib/rewards";
import { createPost, deletePost, hidePost, reportPost, updateProfile, type Deps } from "../lib/server/board";
import { clubEvents } from "../lib/server/clubs";
import { loadProfile, saveRoles } from "../lib/server/clubState";
import { joinClub } from "../lib/server/members";
import { buildEpoch } from "../lib/server/rewards";
import { memoryStore, type Store } from "../lib/server/store";
import { parsePosts, type XApiPost } from "../lib/server/xApi";
import { cardFromOembed, plainText, readXShares, startXLink, unlinkX, verifyXLink, xShareEvents } from "../lib/server/xPosts";
import { collectReach } from "../lib/server/xReach";
import { draftPost, linkString } from "../lib/social";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";
import { clubSignals, matchSignals, normalizeTag, parseXStatus, postedAtOf, signalsHint, xStatusUrl, type XCard } from "../lib/xPosts";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const reg = makeRegistry(parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "Mock Chog", symbol: "MCHOG", status: "verified", note: "Why." }]));
const club = reg.clubFor(NFT)!;
const token = NFT.toLowerCase();
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const NOW = 1_800_000_000_000; // epoch ms
const EPOCH_MS = 1_288_834_974_657n;
/** An X post id made at `ms`. */
const idAt = (ms: number, seq = 1) => (((BigInt(ms) - EPOCH_MS) << 22n) + BigInt(seq)).toString();

const signals = clubSignals([{ address: NFT, symbol: "MCHOG" }], {
  accounts: [{ handle: "ChogNFT", proof: "1", linkedAt: 1, xUserId: "777" }],
  tags: ["#chog", "chogs"],
});

// ─────────────────────────────────────────────────────────────── pure

describe("X links", () => {
  it("reads x.com and twitter.com post links, and nothing else", () => {
    const id = "1861113297428627788";
    for (const url of [
      `https://x.com/jack/status/${id}`,
      `https://twitter.com/jack/status/${id}?s=20`,
      `x.com/i/status/${id}`,
      `https://mobile.x.com/jack/status/${id}/photo/1`,
      `https://x.com/i/web/status/${id}`,
    ]) {
      assert.equal(parseXStatus(url), id, url);
    }
    for (const bad of ["https://x.com/jack", "https://evil.com/jack/status/1", "https://x.com/jack/status/abc", "1861113297428627788", `https://x.com.evil.io/a/status/${id}`]) {
      assert.equal(parseXStatus(bad), null, bad);
    }
  });

  it("signs the canonical link, which reads back to the same post", () => {
    const link = parseLink("https://twitter.com/someone/status/42");
    assert.deepEqual(link, { kind: "x", id: "42" });
    assert.equal(linkString(link!), xStatusUrl("42"));
    assert.deepEqual(parseLink(linkString(link!)), link);
  });

  it("puts an X post on a note, and deals and signed swaps on a Looking for post", () => {
    assert.deepEqual(linkFor("note", "https://x.com/a/status/5"), { kind: "x", id: "5" });
    assert.equal(linkFor("looking", "https://x.com/a/status/5"), null);
    assert.equal(linkFor("note", "42"), null);
    assert.deepEqual(linkFor("looking", "42"), { kind: "deal", id: "42" });
    const d = draftPost(NFT, "note", "gm", "https://x.com/a/status/0005", 1);
    assert.ok(d.ok && d.message.link === "https://x.com/i/status/5");
    assert.deepEqual(draftPost(NFT, "looking", "wtb", "https://x.com/a/status/5", 1), { ok: false, reason: "bad_link" });
  });

  it("reads when a post was made from its id", () => {
    assert.equal(postedAtOf(idAt(NOW)), NOW);
    assert.equal(postedAtOf("20"), null, "the oldest ids carry no time");
  });
});

describe("Club signals", () => {
  it("keeps tags in one form and refuses what isn't one", () => {
    assert.equal(normalizeTag(" #Chog "), "#chog");
    assert.equal(normalizeTag("$CHOG"), "$chog");
    assert.equal(normalizeTag("chogs"), "chogs");
    for (const bad of ["#", "a", "#two words", "https://x", "#" + "a".repeat(31)]) assert.equal(normalizeTag(bad), null, bad);
  });

  it("builds the Club's ticker in, beside the Owner's tags", () => {
    assert.deepEqual(signals.tags, ["$mchog", "#chog", "chogs"]);
    assert.deepEqual(signals.tokens, [token]);
  });

  it("is strong for the Club's address, a link to it, a mention, quote or reply of its account", () => {
    assert.equal(matchSignals(signals, { text: `look at ${NFT}` }), "strong");
    assert.equal(matchSignals(signals, { text: "the club", urls: [`https://declub.app/clubs/${token}`] }), "strong");
    assert.equal(matchSignals(signals, { text: "gm @chognft" }), "strong");
    assert.equal(matchSignals(signals, { text: "so true", referenced: [{ id: "777" }] }), "strong", "a quote, by X's id");
    assert.equal(matchSignals(signals, { text: "so true", referenced: [{ username: "ChogNFT" }] }), "strong", "a reply, by handle");
  });

  it("is weak for a tag alone, matched as a whole word, and none otherwise", () => {
    assert.equal(matchSignals(signals, { text: "love #CHOG" }), "weak");
    assert.equal(matchSignals(signals, { text: "$MCHOG up" }), "weak");
    assert.equal(matchSignals(signals, { text: "my chogs!" }), "weak");
    assert.equal(matchSignals(signals, { text: "#chogger and chogsville" }), null);
    assert.equal(matchSignals(signals, { text: "gm @chognft_fan" }), null);
    assert.equal(matchSignals(signals, { text: "nothing here" }), null);
  });

  it("is a yes or no: stuffing tags doesn't make a post stronger", () => {
    assert.equal(matchSignals(signals, { text: "#chog chogs $MCHOG #chog chogs" }), "weak");
  });

  it("says what counts, in words", () => {
    assert.equal(signalsHint(signals), "links this Club or its token, mentions @chognft, or uses $MCHOG / #chog / chogs");
    assert.equal(signalsHint(clubSignals([], undefined)), "links this Club or its token");
  });

  it("checks the Owner's tags on a profile edit", () => {
    assert.deepEqual(checkProfileEdit({ xTags: ["#Chog", "#chog", "chogs"] }), { ok: true, edit: { xTags: ["#chog", "chogs"] } });
    assert.equal(checkProfileEdit({ xTags: ["no spaces allowed"] }).ok, false);
    assert.equal(checkProfileEdit({ xTags: Array.from({ length: 11 }, (_, i) => `tag${i}`) }).ok, false);
  });
});

describe("reading X", () => {
  it("turns an oEmbed answer into a card", () => {
    const card = cardFromOembed("440322224407314432", {
      author_url: "https://x.com/TheEllenShow",
      html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">If only Bradley&#39;s arm was longer. <a href="https://x.com/hashtag/oscars">#oscars</a> &amp; more</p>&mdash; The Ellen Show (@TheEllenShow) <a href="#">March 3, 2014</a></blockquote>',
    });
    assert.equal(card?.author, "TheEllenShow");
    assert.equal(card?.text, "If only Bradley's arm was longer. #oscars & more");
    assert.equal(cardFromOembed("1", { html: "<p>x</p>" }), null);
    assert.equal(plainText("a<br>b&#x41;&lt;"), "a bA<");
  });

  it("reads the X API's posts: engagement, entities and who they quote", () => {
    const posts = parsePosts({
      data: [
        {
          id: "10",
          author_id: "555",
          text: "gm",
          public_metrics: { like_count: 5, retweet_count: 2, quote_count: 1, reply_count: 3, impression_count: 9999 },
          entities: { mentions: [{ username: "ChogNFT" }], urls: [{ expanded_url: "https://declub.app/clubs/x" }] },
          referenced_tweets: [{ type: "quoted", id: "20" }],
        },
      ],
      includes: { tweets: [{ id: "20", author_id: "777" }], users: [{ id: "777", username: "ChogNFT" }] },
    });
    const post = posts.get("10")!;
    assert.equal(post.engagement, 11, "impressions don't count");
    assert.deepEqual(post.facts.referenced, [{ id: "777", username: "ChogNFT" }]);
    assert.deepEqual(post.facts.urls, ["https://declub.app/clubs/x"]);
  });
});

// ─────────────────────────────────────────────────────────────── X shares through the Board

async function member(store: Store, userId: string, n: number, holder = true) {
  const w = wallet(n);
  await store.set(profileKey(w), { provider: "twitter", handle: `h${n}`, userId, updatedAt: 1 });
  await store.setMembers(userWalletsKey(userId), [w]);
  assert.ok((await joinClub(store, club, userId, [w], { holdings: async () => [holder ? 1n : 0n] })).ok);
  return { userId, wallet: w };
}

/** One X post per id, with the text given; authors by id. */
function xWorld(posts: Record<string, { author: string; text: string }>) {
  const lookupX = async (id: string): Promise<XCard | null> => (posts[id] ? { id, author: posts[id].author, text: posts[id].text, postedAt: postedAtOf(id) } : null);
  return lookupX;
}

const accounts: Record<string, { username: string; subject: string }> = { m1: { username: "alice_x", subject: "111" }, m2: { username: "bob_x", subject: "222" } };
const baseDeps = (lookupX: Deps["lookupX"], now = NOW): Deps => ({
  now: () => now,
  lookupX,
  xAccountOf: async (userId) => accounts[userId] ?? null,
  admins: new Set(),
});
const clear = (store: Store, userId: string) =>
  store.del(`declub:rl:club-post-cd:${token}:${userId}`, `declub:rl:club-post-hr:${token}:${userId}`);
const share = async (store: Store, userId: string, id: string, deps: Deps) => {
  await clear(store, userId);
  return createPost(store, club, userId, { kind: "note", text: "look", link: `https://x.com/a/status/${id}` }, deps);
};

describe("X shares", () => {
  it("shares any public X post as a card, and counts a Holder's own post about the Club", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    const own = idAt(NOW - 3_600_000, 1);
    const theirs = idAt(NOW - 3_600_000, 2);
    const deps = baseDeps(xWorld({ [own]: { author: "Alice_X", text: `gm ${NFT}` }, [theirs]: { author: "someone", text: `gm ${NFT}` } }));

    const a = await share(store, "m1", own, deps);
    assert.ok(a.ok);
    assert.deepEqual(a.xShare, { own: true, counted: "strong" });
    assert.equal(a.post.x?.own, true);
    assert.equal(a.post.x?.counted, "strong");
    assert.deepEqual(a.post.link, { kind: "x", id: own });

    const b = await share(store, "m1", theirs, deps);
    assert.ok(b.ok, "someone else's post is shared as a card");
    assert.deepEqual(b.xShare, { own: false, counted: null, reason: "not_own" });

    const shares = await readXShares(store, token);
    assert.deepEqual(shares.map((s) => [s.tweet, s.wallet, s.strength]), [[own, wallet(1), "strong"]]);
  });

  it("refuses a missing post, and says when X can't be read", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    assert.deepEqual(await share(store, "m1", "99", baseDeps(xWorld({}))), { ok: false, reason: "x_not_found" });
    const down = baseDeps(async () => {
      throw new Error("down");
    });
    assert.deepEqual(await share(store, "m1", "99", down), { ok: false, reason: "x_unavailable" });
  });

  it("counts only from Holders, fresh posts, about the Club, once ever and once a day", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    await member(store, "m2", 2, false);
    const fresh = (seq: number) => idAt(NOW - 3_600_000, seq);
    const old = idAt(NOW - 49 * 3_600_000, 9);
    const world = {
      [fresh(1)]: { author: "bob_x", text: `gm ${NFT}` },
      [old]: { author: "alice_x", text: `gm ${NFT}` },
      [fresh(2)]: { author: "alice_x", text: "nothing about it" },
      [fresh(3)]: { author: "alice_x", text: "#mchog... I mean $MCHOG" },
      [fresh(4)]: { author: "alice_x", text: `again ${NFT}` },
    };
    const deps = baseDeps(xWorld(world));
    const verdict = async (userId: string, id: string) => {
      const r = await share(store, userId, id, deps);
      assert.ok(r.ok);
      return r.xShare;
    };
    assert.equal((await verdict("m2", fresh(1)))?.reason, "not_holder");
    assert.equal((await verdict("m1", old))?.reason, "too_old");
    assert.equal((await verdict("m1", fresh(2)))?.reason, "no_signal");
    assert.deepEqual(await verdict("m1", fresh(3)), { own: true, counted: "weak" });
    assert.equal((await verdict("m1", fresh(4)))?.reason, "daily_limit");

    // The next day the same post can't count twice.
    const tomorrow = baseDeps(xWorld(world), NOW + 86_400_000);
    await clear(store, "m1");
    const again = await createPost(store, club, "m1", { kind: "note", text: "again", link: `https://x.com/a/status/${fresh(3)}` }, tomorrow);
    assert.ok(again.ok);
    assert.equal(again.xShare?.reason, "already_counted");
  });

  it("stops counting while the Board post is hidden, and for good once it's deleted", async () => {
    const store = memoryStore();
    const owner = await member(store, "own", 5);
    await member(store, "m1", 1);
    await saveRoles(store, token, { owner: "own", moderators: [] });
    const id = idAt(NOW - 60_000);
    const deps = baseDeps(xWorld({ [id]: { author: "alice_x", text: `gm ${NFT}` } }));
    const r = await share(store, "m1", id, deps);
    assert.ok(r.ok && r.xShare?.counted);

    await hidePost(store, club, owner, r.post.id, true, deps);
    assert.equal((await readXShares(store, token)).length, 0);
    await hidePost(store, club, owner, r.post.id, false, deps);
    assert.equal((await readXShares(store, token)).length, 1);

    await deletePost(store, club, { userId: "m1", wallet: wallet(1) }, r.post.id, deps);
    assert.equal((await readXShares(store, token)).length, 0);
  });

  it("stops counting when reports hide the post", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    for (const [u, n] of [["r1", 11], ["r2", 12], ["r3", 13]] as const) await member(store, u, n);
    const id = idAt(NOW - 60_000);
    const deps = baseDeps(xWorld({ [id]: { author: "alice_x", text: `gm ${NFT}` } }));
    const r = await share(store, "m1", id, deps);
    assert.ok(r.ok);
    for (const u of ["r1", "r2", "r3"]) await reportPost(store, club, u, r.post.id, deps);
    assert.equal((await readXShares(store, token)).length, 0);
  });

  it("adds to the member's Momentum, not to the Club's count of traders", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    const id = idAt(NOW - 60_000);
    assert.ok((await share(store, "m1", id, baseDeps(xWorld({ [id]: { author: "alice_x", text: `gm ${NFT}` } })))).ok);
    const events = await clubEvents(store, club, { settlements: async () => [] });
    assert.deepEqual(events.map((e) => e.kind), ["xshare"]);
    const scores = score(events.map((e) => ({ kind: e.kind, at: e.at, parties: e.parties, weight: e.weight })), Math.floor(NOW / 1000));
    assert.equal(memberScore(scores, [wallet(1)]), MOMENTUM.xShareWeight);
    assert.equal(scores.uniqueWallets, 0);
  });

  it("counts a weak share for half", () => {
    const at = Math.floor(NOW / 1000);
    const scores = score([{ kind: "xshare", at, parties: [wallet(1)], weight: 0.5 }], at);
    assert.equal(memberScore(scores, [wallet(1)]), MOMENTUM.xShareWeight / 2);
  });
});

// ─────────────────────────────────────────────────────────────── linking the project's account

describe("linking the project's X account", () => {
  async function owned() {
    const store = memoryStore();
    const owner = await member(store, "own", 5);
    const other = await member(store, "m1", 1);
    await saveRoles(store, token, { owner: "own", moderators: [] });
    return { store, owner, other };
  }

  it("links an account by a post from it with the code, and anyone can see the proof", async () => {
    const { store, owner } = await owned();
    const started = await startXLink(store, club, owner, "@ChogNFT", { now: () => NOW });
    assert.ok(started.ok);
    assert.ok(started.text.includes(started.code) && started.text.includes("@ChogNFT"));

    const posts: Record<string, { author: string; text: string }> = { "500": { author: "ChogNFT", text: started.text } };
    const linked = await verifyXLink(store, club, owner, { handle: "chognft", url: "https://x.com/ChogNFT/status/500" }, {
      now: () => NOW,
      lookupX: xWorld(posts),
      xUserIdOf: async () => "777",
    });
    assert.ok(linked.ok);
    assert.deepEqual(linked.profile.x?.accounts, [{ handle: "ChogNFT", proof: "500", linkedAt: NOW, xUserId: "777" }]);

    // Now a member's post that only mentions it counts in full.
    await member(store, "m2", 2);
    const id = idAt(NOW - 60_000);
    const r = await share(store, "m2", id, baseDeps(xWorld({ [id]: { author: "bob_x", text: "gm @ChogNFT" } })));
    assert.ok(r.ok);
    assert.equal(r.xShare?.counted, "strong");

    assert.ok((await unlinkX(store, club, owner, "@chognft", { now: () => NOW })).ok);
    assert.deepEqual((await loadProfile(store, token)).x?.accounts, []);
  });

  it("refuses the wrong author, a missing or expired code, and anyone but the Owner", async () => {
    const { store, owner, other } = await owned();
    assert.deepEqual(await startXLink(store, club, other, "ChogNFT", { now: () => NOW }), { ok: false, reason: "forbidden" });
    assert.deepEqual(await startXLink(store, club, owner, "not a handle!", { now: () => NOW }), { ok: false, reason: "bad_handle" });
    const started = await startXLink(store, club, owner, "ChogNFT", { now: () => NOW });
    assert.ok(started.ok);
    const verify = (posts: Record<string, { author: string; text: string }>, now = NOW, handle = "ChogNFT") =>
      verifyXLink(store, club, owner, { handle, url: "https://x.com/x/status/500" }, { now: () => now, lookupX: xWorld(posts), xUserIdOf: async () => null });

    assert.deepEqual(await verify({ "500": { author: "Impostor", text: started.text } }), { ok: false, reason: "xlink_mismatch" });
    assert.deepEqual(await verify({ "500": { author: "ChogNFT", text: "no code here" } }), { ok: false, reason: "xlink_mismatch" });
    assert.deepEqual(await verify({ "500": { author: "Other", text: started.text } }, NOW, "Other"), { ok: false, reason: "xlink_expired" }, "a code is for one handle");
    assert.deepEqual(await verify({ "500": { author: "ChogNFT", text: started.text } }, NOW + 25 * 3_600_000), { ok: false, reason: "xlink_expired" });
  });

  it("links at most three accounts", async () => {
    const { store, owner } = await owned();
    for (const handle of ["one", "two", "three"]) {
      const s = await startXLink(store, club, owner, handle, { now: () => NOW });
      assert.ok(s.ok);
      const r = await verifyXLink(store, club, owner, { handle, url: "https://x.com/x/status/7" }, {
        now: () => NOW,
        lookupX: xWorld({ "7": { author: handle, text: s.text } }),
        xUserIdOf: async () => null,
      });
      assert.ok(r.ok, handle);
    }
    assert.deepEqual(await startXLink(store, club, owner, "four", { now: () => NOW }), { ok: false, reason: "too_many_accounts" });
  });

  it("keeps linked accounts when the Owner edits tags", async () => {
    const { store, owner } = await owned();
    const s = await startXLink(store, club, owner, "ChogNFT", { now: () => NOW });
    assert.ok(s.ok);
    await verifyXLink(store, club, owner, { handle: "ChogNFT", url: "https://x.com/x/status/7" }, { now: () => NOW, lookupX: xWorld({ "7": { author: "ChogNFT", text: s.text } }), xUserIdOf: async () => null });
    const r = await updateProfile(store, club, owner, { xTags: ["#chog"] });
    assert.ok(r.ok);
    assert.deepEqual(r.profile.x?.tags, ["#chog"]);
    assert.equal(r.profile.x?.accounts.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────── reach and the Holder bonus

const GENESIS = Math.floor(NOW / 1000) - 3_600;
const LENGTH = 7_200;

describe("the reach read", () => {
  async function shared() {
    const store = memoryStore();
    await member(store, "m1", 1);
    await member(store, "m2", 2);
    const a = idAt(NOW - 60_000, 1);
    const b = idAt(NOW - 60_000, 2);
    const world = xWorld({ [a]: { author: "alice_x", text: `gm ${NFT}` }, [b]: { author: "bob_x", text: "#x $MCHOG" } });
    assert.ok((await share(store, "m1", a, baseDeps(world))).ok);
    assert.ok((await share(store, "m2", b, baseDeps(world))).ok);
    return { store, a, b };
  }
  const api = (posts: XApiPost[]) => async () => new Map(posts.map((p) => [p.id, p]));

  it("re-checks each X share with the API: author by X id, signals, engagement", async () => {
    const { store, a, b } = await shared();
    const record = await collectReach(store, 0, {
      now: () => GENESIS + LENGTH,
      clubs: [club],
      genesis: GENESIS,
      length: LENGTH,
      configured: true,
      xAccountOf: async (userId) => accounts[userId] ?? null,
      posts: api([
        { id: a, authorId: "111", engagement: 31, facts: { text: "edited away", urls: [`https://declub.app/clubs/${token}`] } },
        { id: b, authorId: "999", engagement: 500, facts: { text: "$MCHOG" } },
      ]),
    });
    assert.deepEqual(record.posts[a], { club: token, wallet: wallet(1), ok: true, strength: "strong", engagement: 31 });
    assert.deepEqual(record.posts[b], { club: token, wallet: wallet(2), ok: false, strength: null, engagement: 0, reason: "not_author" });
  });

  it("counts a deleted post as nothing, and records that reach wasn't read without a token", async () => {
    const { store, a } = await shared();
    const gone = await collectReach(store, 0, { now: () => GENESIS + LENGTH, clubs: [club], genesis: GENESIS, length: LENGTH, configured: true, xAccountOf: async (u) => accounts[u] ?? null, posts: api([]) });
    assert.equal(gone.posts[a]?.reason, "deleted");
    const off = await collectReach(store, 0, { now: () => GENESIS + LENGTH, clubs: [club], genesis: GENESIS, length: LENGTH, configured: false });
    assert.deepEqual(off.posts, {});
    assert.equal(off.available, false);
  });
});

const swapEvent = (at: number, parties: string[], seq = 0): ActivityEvent => ({
  id: `0x${seq}:1`,
  kind: "swapped",
  contract: "0xc",
  deal: String(seq),
  block: 1,
  at,
  parties,
  tokens: [token],
  fee: "1000",
});
const xEvent = (at: number, w: string, tweet: string, weight = 1): ActivityEvent => ({ id: `x:${tweet}`, kind: "xshare", contract: "", deal: tweet, block: 0, at, parties: [w], tokens: [token], weight });

describe("the Holder bonus", () => {
  const end = 2_000;
  it("counts trading as Momentum does, with no decay", () => {
    const events = [swapEvent(100, [wallet(1), wallet(2)], 1), swapEvent(200, [wallet(1), wallet(3)], 2)];
    const a = activityPoints(events, null, [wallet(1)], end);
    assert.equal(a.trading, 2 * MOMENTUM.swapWeight);
    assert.equal(a.bonusBps, bonusBps(20));
  });

  it("adds X shares: base points, reach on a log scale, capped per epoch", () => {
    const events = [xEvent(100, wallet(1), "a"), xEvent(200, wallet(1), "b", 0.5)];
    const reach = (posts: ReachRecord["posts"]): ReachRecord => ({ n: 0, collectedAt: 1, available: true, posts });
    const entry = (engagement: number, strength: "strong" | "weak" = "strong") => ({ club: token, wallet: wallet(1), ok: true, strength, engagement });

    assert.equal(activityPoints(events, null, [wallet(1)], end).x, REWARDS.xShareBase * 1.5, "no reach read: base only, a weak share half");
    const some = activityPoints(events, reach({ a: entry(7), b: entry(3, "weak") }), [wallet(1)], end);
    assert.equal(some.x, REWARDS.xShareBase * 1.5 + REWARDS.reachWeight * (3 + 0.5 * 2));
    const viral = activityPoints(events, reach({ a: entry(10 ** 12), b: entry(0, "weak") }), [wallet(1)], end);
    assert.equal(viral.x, REWARDS.xShareBase * 1.5 + REWARDS.reachCapPerEpoch);
    const gone = activityPoints(events, reach({ a: { ...entry(0), ok: false, strength: null }, b: entry(0, "weak") }), [wallet(1)], end);
    assert.equal(gone.x, REWARDS.xShareBase * 0.5, "a post the reach read refused counts nothing");
  });

  it("is between none and the cap", () => {
    assert.equal(bonusBps(0), 0);
    assert.equal(bonusBps(REWARDS.fullBonusPoints / 2), REWARDS.maxBonusBps / 2);
    assert.equal(bonusBps(10_000), REWARDS.maxBonusBps);
  });

  it("weights shares by (1 + bonus), pays the pool exactly, and rolls the dust over", () => {
    const split = splitClub({
      club: token,
      fees: 10_000n,
      carried: { holders: 1n, fund: 0n },
      holders: [
        { wallet: wallet(1), shares: 1n, bonusBps: 5_000 },
        { wallet: wallet(2), shares: 1n, bonusBps: 0 },
        { wallet: wallet(3), shares: 2n, bonusBps: 99_999 },
      ],
      owner: null,
    });
    const paid = Object.fromEntries(split.payouts.map((p) => [p.wallet, p.amount]));
    // Weights 1.5 : 1 : 3 (the third is capped at +50%) over a pool of 5,001.
    assert.equal(paid[wallet(1)], (5_001n * 15_000n) / 55_000n);
    assert.equal(paid[wallet(3)], (5_001n * 30_000n) / 55_000n);
    assert.equal(split.paidHolders + split.carry.holders, split.holderPool);
    assert.equal(split.payouts.find((p) => p.wallet === wallet(3))?.bonusBps, REWARDS.maxBonusBps);
  });

  it("gains nothing by splitting holdings across accounts", () => {
    const one = splitClub({ club: token, fees: 1_000_000n, carried: { holders: 0n, fund: 0n }, holders: [{ wallet: wallet(1), shares: 2n, bonusBps: 2_000 }, { wallet: wallet(9), shares: 2n, bonusBps: 0 }], owner: null });
    const two = splitClub({
      club: token,
      fees: 1_000_000n,
      carried: { holders: 0n, fund: 0n },
      holders: [{ wallet: wallet(1), shares: 1n, bonusBps: 2_000 }, { wallet: wallet(2), shares: 1n, bonusBps: 2_000 }, { wallet: wallet(9), shares: 2n, bonusBps: 0 }],
      owner: null,
    });
    const sum = (s: typeof one, ws: string[]) => s.payouts.filter((p) => ws.includes(p.wallet)).reduce((t, p) => t + p.amount, 0n);
    // Equal, but for the wei each extra account's payout rounds down.
    const gain = sum(two, [wallet(1), wallet(2)]) - sum(one, [wallet(1)]);
    assert.ok(gain <= 0n && gain >= -1n, `gain ${gain}`);
  });

  it("is applied by the epoch builder, from the window's activity and the saved reach", async () => {
    const store = memoryStore();
    await member(store, "m1", 1);
    await member(store, "m2", 2);
    const at = GENESIS + 60;
    const events = [swapEvent(at, [wallet(1), wallet(5)], 1), xEvent(at, wallet(2), "t1")];
    const reach: ReachRecord = { n: 0, collectedAt: at, available: true, posts: { t1: { club: token, wallet: wallet(2), ok: true, strength: "strong", engagement: 15 } } };
    const result = await buildEpoch(store, 0, {
      now: () => GENESIS + LENGTH,
      clubs: [club],
      events: async () => events,
      holdings: async (_t, ws) => ws.map(() => 1n),
      chainId: 10143,
      contract: getAddress(wallet(0xee)),
      genesis: GENESIS,
      length: LENGTH,
      reach: async () => reach,
    });
    assert.equal(result.status, "built");
    const record = result.status === "built" ? result.record : null;
    const holder = (w: string) => record!.leaves.find((l) => l.account === getAddress(w))!.breakdown.find((b) => b.kind === "holder")!;
    assert.equal(holder(wallet(1)).bonusBps, bonusBps(MOMENTUM.swapWeight));
    assert.equal(holder(wallet(2)).bonusBps, bonusBps(REWARDS.xShareBase + REWARDS.reachWeight * 4));
    assert.equal(holder(wallet(1)).shares, "1");
    assert.deepEqual(record!.reach, reach, "the reach is published with the epoch");
  });
});

describe("X share events", () => {
  it("credit the member's Club wallet with the share's strength", () => {
    const [e] = xShareEvents([{ tweet: "5", club: token, userId: "u", wallet: wallet(1).toUpperCase(), postId: "p", at: 9, strength: "weak" }]);
    assert.deepEqual(e, { id: "x:5", kind: "xshare", contract: "", deal: "5", block: 0, at: 9, parties: [wallet(1).toLowerCase()], tokens: [token], weight: 0.5 });
  });
});
