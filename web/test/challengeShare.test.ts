import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { challengePageUrl, challengeShareText, challengeShareUrl, endsText, namesText } from "../lib/challengeShare";
import type { PublicChallenge, Winner } from "../lib/challenges";

const ALICE = "0x00000000000000000000000000000000000a11CE";
const BOB = "0x0000000000000000000000000000000000000b0b";
const CAROL = "0x00000000000000000000000000000000000ca401";
const TOKEN = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const ENDS = Date.UTC(2026, 9, 12, 0, 0);

const challenge = (over: Partial<PublicChallenge> = {}): PublicChallenge => ({
  id: "11111111-2222-3333-4444-555555555555",
  title: "Best Chog meme",
  brief: "Post your best Chog meme on X.",
  judging: "likes",
  prizes: [10, 5, 2],
  holdersOnly: false,
  startsAt: ENDS - 7 * 86_400_000,
  endsAt: ENDS,
  by: CAROL,
  phase: "open",
  entries: [],
  entryCount: 4,
  ...over,
});

const win = (wallet: string, place: number, post = `post-${place}`): Winner => ({ post, wallet, place, points: [10, 5, 2][place - 1] ?? 1 });
const settled = (winners: Winner[], over: Partial<PublicChallenge> = {}) =>
  challenge({ phase: "settled", settled: { at: ENDS + 1, epoch: 3, winners }, ...over });
const names: Record<string, string> = { [ALICE.toLowerCase()]: "@alice", [BOB.toLowerCase()]: "@bob", [CAROL.toLowerCase()]: "@carol" };
const nameOf = (w: string) => names[w.toLowerCase()];

/** X counts a link as 23 characters, plus the space before it. */
const fits = (text: string) => assert.ok(text.length + 24 <= 280, `${text.length} characters: ${text}`);

describe("challengeShareText", () => {
  it("says a winner's place, matching any case of their wallet", () => {
    const text = challengeShareText(settled([win(ALICE, 1), win(BOB, 2)]), { club: "Chog", viewerWallets: [BOB.toUpperCase().replace("0X", "0x")] });
    assert.match(text, /^I won 2nd place in “Best Chog meme” in the Chog Club on DeClub 🏆/);
  });

  it("knows a winner by their entry, without a wallet", () => {
    const text = challengeShareText(settled([win(ALICE, 1, "p1")], { mine: "p1" }), { club: "Chog" });
    assert.match(text, /^I won 1st place in “Best Chog meme”/);
  });

  it("makes every winner of a flat challenge a winner, not a place", () => {
    const winners = [win(ALICE, 1), win(BOB, 2), win(CAROL, 3)];
    const c = settled(winners, { judging: "raffle", prizes: [5, 5, 5], winners: 3, prize: 5 });
    assert.match(challengeShareText(c, { club: "Chog", viewerWallets: [CAROL] }), /^I’m a winner of “Best Chog meme” in the Chog Club on DeClub 🏆/);
  });

  it("asks for likes on an entry when likes decide, and not when the Owner does", () => {
    assert.equal(
      challengeShareText(challenge({ mine: "p1" }), { club: "Chog" }),
      "I entered “Best Chog meme” in the Chog Club on DeClub ✍️\n\nLike my entry to push it up 👇",
    );
    assert.doesNotMatch(challengeShareText(challenge({ mine: "p1", judging: "owner" }), { club: "Chog" }), /Like my entry/);
  });

  it("invites anyone else to enter an open challenge, by when it ends", () => {
    const text = challengeShareText(challenge(), { club: "Chog", viewerWallets: [ALICE] });
    assert.equal(text, "Chog Club challenge: “Best Chog meme” — enter by Oct 12, 00:00 UTC 🏆\n\nPost about it on X, share it on the Club’s Board 👇");
  });

  it("posts the podium for anyone else, naming the winners when it can", () => {
    const c = settled([win(BOB, 2), win(ALICE, 1), win(CAROL, 3)]);
    assert.equal(
      challengeShareText(c, { club: "Chog", nameOf }),
      "Results are in for “Best Chog meme” in the Chog Club on DeClub 🏆\n\n1st: @alice\n2nd: @bob\n3rd: @carol",
    );
    assert.equal(challengeShareText(c, { club: "Chog" }), "Results are in for “Best Chog meme” in the Chog Club on DeClub 🏆");
  });

  it("counts the winners of a flat challenge and names three at most", () => {
    const winners = Array.from({ length: 7 }, (_, i) => win([ALICE, BOB, CAROL][i % 3]!, i + 1, `p${i}`));
    const c = settled(winners, { judging: "everyone", prizes: Array(7).fill(3), winners: 7, prize: 3 });
    assert.equal(
      challengeShareText(c, { club: "Chog", nameOf }),
      "Results are in for “Best Chog meme” in the Chog Club on DeClub 🏆\n\n7 winners: @alice, @bob, @carol and 4 more",
    );
  });

  it("is neutral for one waiting on its results, with no winner, or called off", () => {
    assert.match(challengeShareText(challenge({ phase: "closing" }), { club: "Chog" }), /has ended\. The results are coming/);
    assert.equal(challengeShareText(settled([]), { club: "Chog" }), "A challenge in the Chog Club on DeClub: “Best Chog meme”");
    assert.equal(challengeShareText(challenge({ phase: "cancelled" }), { club: "Chog" }), "A challenge in the Chog Club on DeClub: “Best Chog meme”");
  });

  it("clips a long title, Club name and handles so every post fits with its link", () => {
    const long = { title: "T".repeat(200) };
    const club = "C".repeat(80);
    const longName = (w: string) => `@${"n".repeat(40)}${w.slice(-2)}`;
    const cases = [
      challengeShareText(challenge({ ...long }), { club }),
      challengeShareText(challenge({ ...long, mine: "p1" }), { club }),
      challengeShareText(settled([win(ALICE, 1)], long), { club, viewerWallets: [ALICE] }),
      challengeShareText(settled([win(ALICE, 1), win(BOB, 2), win(CAROL, 3)], long), { club, nameOf: longName }),
      challengeShareText(
        settled(
          Array.from({ length: 25 }, (_, i) => win(ALICE, i + 1, `p${i}`)),
          { ...long, judging: "first", prizes: Array(25).fill(1) },
        ),
        { club, nameOf: longName },
      ),
      challengeShareText(settled([win(ALICE, 1), win(BOB, 2)], { ...long, judging: "raffle" }), { club, viewerWallets: [BOB] }),
      challengeShareText(challenge({ ...long, phase: "judging" }), { club }),
    ];
    for (const text of cases) fits(text);
    assert.match(cases[0]!, /“T{59}…”/);
  });
});

describe("challengeShareUrl", () => {
  it("links X's compose box with the text and the challenge's page", () => {
    const c = challenge();
    const url = new URL(challengeShareUrl(c, { club: "Chog", token: TOKEN, origin: "https://declub.fun/" }));
    assert.equal(url.origin + url.pathname, "https://x.com/intent/post");
    assert.equal(url.searchParams.get("text"), challengeShareText(c, { club: "Chog" }));
    assert.equal(url.searchParams.get("url"), `https://declub.fun/clubs/${TOKEN.toLowerCase()}/challenges/${c.id}`);
  });

  it("defaults to where the app is served", () => {
    assert.match(challengePageUrl(TOKEN, "abc"), /^https?:\/\/[^/]+\/clubs\/0x220a2c52fd27252e7cd6163a7bf1b6ae159d26e4\/challenges\/abc$/);
  });
});

describe("wording helpers", () => {
  it("words names and end times", () => {
    assert.equal(namesText(["@a"]), "@a");
    assert.equal(namesText(["@a", "@b"]), "@a and @b");
    assert.equal(namesText(["@a", "@b", "@c"], 3), "@a, @b and @c");
    assert.equal(namesText(["@a", "@b", "@c"], 5), "@a, @b, @c and 2 more");
    assert.equal(endsText(Date.UTC(2026, 0, 3, 9, 5)), "Jan 3, 09:05 UTC");
  });
});
