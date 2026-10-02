import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../lib/clubs";
import {
  HOLDER_RECHECK_MS,
  MEMBERS_SHOWN,
  RECHECK_PER_READ,
  isHolder,
  pickDisplayWallet,
  rankMembers,
  staleRows,
  withWallets,
  type MemberRow,
} from "../lib/members";
import { score } from "../lib/momentum";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";

const row = (userId: string, over: Partial<MemberRow> = {}): MemberRow => ({
  userId,
  wallets: [A],
  displayWallet: A,
  holder: false,
  holderCheckedAt: 1_000,
  joinedAt: 1_000,
  ...over,
});

describe("isHolder", () => {
  it("is any NFT for an ERC-721, summed over wallets", () => {
    assert.equal(isHolder({ kind: "erc721" }, []), false);
    assert.equal(isHolder({ kind: "erc721" }, [0n, 0n]), false);
    assert.equal(isHolder({ kind: "erc721" }, [0n, 1n]), true);
    assert.equal(isHolder({ kind: "erc721", minHolding: "5" }, [1n]), true, "minHolding is for ERC-20 only");
  });

  it("is at least minHolding for an ERC-20, summed over wallets, and any balance without one", () => {
    const token = { kind: "erc20" as const, minHolding: "1000" };
    assert.equal(isHolder(token, [999n]), false);
    assert.equal(isHolder(token, [1000n]), true);
    assert.equal(isHolder(token, [600n, 400n]), true);
    assert.equal(isHolder({ kind: "erc20" }, [0n]), false);
    assert.equal(isHolder({ kind: "erc20" }, [1n]), true);
  });
});

describe("pickDisplayWallet", () => {
  it("prefers a wallet with a shared profile, else the first, lowercased", () => {
    assert.equal(pickDisplayWallet([A, B], new Set([B])), B);
    assert.equal(pickDisplayWallet([A, B], new Set()), A);
    assert.equal(pickDisplayWallet(["0xAbC"], new Set()), "0xabc");
    assert.equal(pickDisplayWallet([], new Set()), undefined);
  });
});

describe("withWallets", () => {
  it("returns the same row when nothing changed", () => {
    const r = row("u");
    assert.equal(withWallets(r, [A.toUpperCase().replace("0X", "0x")], A), r);
  });

  it("forces a balance re-check when the wallets changed, and only then", () => {
    const r = row("u", { holder: true, holderCheckedAt: 5_000 });
    const added = withWallets(r, [A, B], A);
    assert.deepEqual(added.wallets, [A, B]);
    assert.equal(added.holderCheckedAt, 0);
    const swapped = withWallets(r, [A], B);
    assert.equal(swapped.displayWallet, B);
    assert.equal(swapped.holderCheckedAt, 5_000, "a different display wallet doesn't change the balance");
  });
});

describe("staleRows", () => {
  const now = 10 * HOLDER_RECHECK_MS;
  it("picks rows checked a day ago or more, oldest first", () => {
    const rows = [
      row("fresh", { holderCheckedAt: now - 1000 }),
      row("old", { holderCheckedAt: now - HOLDER_RECHECK_MS }),
      row("never", { holderCheckedAt: 0 }),
    ];
    assert.deepEqual(staleRows(rows, now).map((r) => r.userId), ["never", "old"]);
  });

  it("caps how many one read re-checks", () => {
    const rows = Array.from({ length: RECHECK_PER_READ + 10 }, (_, i) => row(`u${i}`, { holderCheckedAt: i }));
    const picked = staleRows(rows, now);
    assert.equal(picked.length, RECHECK_PER_READ);
    assert.equal(picked[0]!.userId, "u0");
  });
});

describe("rankMembers", () => {
  const now = 2_000_000;
  const swap = (id: string, parties: string[], at = now - 60): ActivityEvent => ({
    id, kind: "swapped", contract: "0xc", deal: id, block: 1, at, parties, tokens: ["0xt"],
  });
  const events = [swap("s1", [A, B]), swap("s2", [A, C], now - 3 * 86_400)];
  const scores = score(events, now);
  const rows = [
    row("a", { wallets: [A], displayWallet: A, joinedAt: 300, holder: true }),
    row("b", { wallets: [B], displayWallet: B, joinedAt: 100 }),
    row("c", { wallets: [C], displayWallet: C, joinedAt: 200 }),
    row("d", { wallets: [], displayWallet: "0xd4", joinedAt: 50 }),
  ];

  it("ranks by Momentum with swaps and holder counts, ties going to the earlier join", () => {
    const view = rankMembers(rows, scores, events, "momentum");
    assert.deepEqual(view.members.map((m) => m.wallet), [A, B, C, "0xd4"]);
    assert.equal(view.members[0]!.swaps, 2);
    assert.equal(view.members[1]!.swaps, 1);
    assert.equal(view.members[3]!.momentum, 0);
    assert.equal(view.total, 4);
    assert.equal(view.holders, 1);
    // B and C: B swapped 60 s ago, C 3 days ago, so B leads; D (never traded) is last despite joining first.
    assert.ok(view.members[1]!.momentum > view.members[2]!.momentum);
  });

  it("sorts newest first for 'new'", () => {
    const view = rankMembers(rows, scores, events, "new");
    assert.deepEqual(view.members.map((m) => m.wallet), [A, C, B, "0xd4"]);
  });

  it("shows the top of a big Club but counts everyone, and never exposes a user id", () => {
    const many = Array.from({ length: MEMBERS_SHOWN + 25 }, (_, i) =>
      row(`secret-${i}`, { wallets: [`0x${i.toString(16).padStart(40, "0")}`], displayWallet: `0x${i.toString(16).padStart(40, "0")}`, joinedAt: i }),
    );
    const view = rankMembers(many, scores, [], "new");
    assert.equal(view.members.length, MEMBERS_SHOWN);
    assert.equal(view.total, MEMBERS_SHOWN + 25);
    assert.ok(!JSON.stringify(view).includes("secret-"));
  });
});
