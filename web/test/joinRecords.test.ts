import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { UserGate } from "../lib/server/gate";
import { exportJoins, hasSigned, recordJoin, restoreJoins, type JoinDeps, type UserOfWallet } from "../lib/server/joinRecords";
import { membershipHandlers } from "../lib/server/memberRoutes";
import { getMember, joinClub, joinRecordKey, leaveClub, membersKey, type Holdings } from "../lib/server/members";
import { memoryStore, type Store } from "../lib/server/store";
import { joinTypedData, type JoinMessage } from "../lib/social";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const PETS = "0x0000000000000000000000000000000000000077";
const reg = makeRegistry(
  parseAssets([NFT, PETS].map((address) => ({ chainId: 10143, address, kind: "erc721", name: "N", symbol: "S", status: "verified", note: "Why." }))),
);
const club = reg.clubFor(NFT)!;
const pets = reg.clubFor(PETS)!;

const ALICE = privateKeyToAccount(`0x${"01".repeat(32)}`);
const BOB = privateKeyToAccount(`0x${"02".repeat(32)}`);
const OTHER_WALLET: Address = getAddress("0x00000000000000000000000000000000000000c3");
const NOW = 1_800_000_000;
const holdings: Holdings = async (_token, wallets) => wallets.map(() => 1n);
const member = { holdings, now: () => NOW * 1000 };

const sign = async (who: typeof ALICE, over: Partial<JoinMessage> = {}, at = NOW) => {
  const message: JoinMessage = { club: club.address as Address, wallet: who.address, at, ...over };
  return { message, signature: await who.signTypedData(joinTypedData(message)) };
};

describe("signed memberships (ADR 0053)", () => {
  let store: Store;
  beforeEach(async () => {
    store = memoryStore();
    await joinClub(store, club, "alice", [ALICE.address], member);
    await joinClub(store, club, "bob", [BOB.address], member);
  });

  it("keeps a member's signature for the wallet they are shown under", async () => {
    assert.equal(await hasSigned(store, club.address, "alice", ALICE.address), false);
    assert.deepEqual(await recordJoin(store, club, "alice", await sign(ALICE), member), { ok: true });
    assert.equal(await hasSigned(store, club.address, "alice", ALICE.address), true);
    assert.equal(await hasSigned(store, club.address, "bob", BOB.address), false);
  });

  it("refuses what it can't stand behind", async () => {
    const refusal = async (userId: string, body: { message: unknown; signature: unknown }, deps: JoinDeps & typeof member = member) => {
      const out = await recordJoin(store, club, userId, body, deps);
      return out.ok ? "ok" : out.reason;
    };
    const good = await sign(ALICE);
    assert.equal(await refusal("alice", { message: null, signature: good.signature }), "unsigned");
    assert.equal(await refusal("alice", { message: good.message, signature: "nope" }), "unsigned");
    assert.equal(await refusal("nobody", good), "not_member");
    assert.equal(await refusal("alice", await sign(ALICE, { club: pets.address as Address })), "wrong_club");
    // Bob can't submit Alice's consent as his own, nor sign for a wallet he is not shown under.
    assert.equal(await refusal("bob", good), "wrong_wallet");
    assert.equal(await refusal("alice", await sign(ALICE, { wallet: OTHER_WALLET })), "wrong_wallet");
    assert.equal(await refusal("alice", await sign(ALICE, {}, NOW - 301)), "stale");
    assert.equal(
      await refusal("alice", { message: good.message, signature: (await sign(BOB)).signature }, { ...member, verifyJoin: async () => false }),
      "bad_signature",
    );
    assert.equal(await store.get(joinRecordKey(club.address, "alice")), null, "nothing was kept");
  });

  it("exports only signatures that still match the wallet a member is shown under", async () => {
    await recordJoin(store, club, "alice", await sign(ALICE), member);
    await recordJoin(store, club, "bob", await sign(BOB), member);
    assert.equal((await exportJoins(store, club)).length, 2);
    // Bob's wallets change and his shown wallet moves: his old consent no longer describes the list.
    await joinClub(store, club, "bob", [OTHER_WALLET], member);
    assert.deepEqual(
      (await exportJoins(store, club)).map((r) => r.message.wallet),
      [ALICE.address],
    );
  });

  it("drops the signature when a member leaves, so a backup never brings back who left", async () => {
    await recordJoin(store, club, "alice", await sign(ALICE), member);
    await leaveClub(store, club.address, "alice");
    assert.equal(await store.get(joinRecordKey(club.address, "alice")), null);
    assert.deepEqual(await exportJoins(store, club), []);
  });

  describe("restore", () => {
    const accounts: Record<string, { userId: string; wallets: string[] }> = {};
    const userOfWallet: UserOfWallet = async (wallet) => accounts[wallet.toLowerCase()] ?? null;
    beforeEach(() => {
      accounts[ALICE.address.toLowerCase()] = { userId: "alice", wallets: [ALICE.address.toLowerCase()] };
      accounts[BOB.address.toLowerCase()] = { userId: "bob", wallets: [BOB.address.toLowerCase()] };
    });

    it("rebuilds the list from the backup after the store is lost, and keeps the proof", async () => {
      await recordJoin(store, club, "alice", await sign(ALICE), member);
      await recordJoin(store, club, "bob", await sign(BOB), member);
      const backup = await exportJoins(store, club);

      store = memoryStore();
      const out = await restoreJoins(store, club, backup, userOfWallet, { member });
      assert.deepEqual(out, { restored: 2, resign: [], skipped: [] });
      assert.equal(await store.countMembers(membersKey(club.address)), 2);
      const row = await getMember(store, club.address, "alice");
      assert.equal(row?.displayWallet, ALICE.address.toLowerCase());
      assert.equal(row?.joinedAt, NOW * 1000, "joined when they signed");
      assert.equal(await hasSigned(store, club.address, "alice", ALICE.address), true);
      assert.equal((await exportJoins(store, club)).length, 2, "and the next backup has them again");
    });

    it("is safe to run twice", async () => {
      await recordJoin(store, club, "alice", await sign(ALICE), member);
      const backup = await exportJoins(store, club);
      store = memoryStore();
      await restoreJoins(store, club, backup, userOfWallet, { member });
      await restoreJoins(store, club, backup, userOfWallet, { member });
      assert.equal(await store.countMembers(membersKey(club.address)), 1);
    });

    it("adds nobody who didn't sign, whatever the file says", async () => {
      const alice = await sign(ALICE);
      const mallory = await sign(BOB, { wallet: ALICE.address }); // Bob's signature on Alice's message
      const records = [
        { message: alice.message, signature: mallory.signature },
        { message: { ...alice.message, club: pets.address }, signature: alice.signature },
        { message: (await sign(BOB)).message, signature: "0x" },
        { message: "junk", signature: alice.signature },
        null,
      ];
      store = memoryStore();
      const out = await restoreJoins(store, club, records, userOfWallet, { member, verifyJoin: async () => false });
      assert.equal(out.restored, 0);
      assert.equal(out.skipped.length, records.length);
      assert.equal(await store.countMembers(membersKey(club.address)), 0);
    });

    it("skips a wallet no account has linked now, or whose account lost it", async () => {
      const backup = [await sign(ALICE), await sign(BOB)];
      store = memoryStore();
      delete accounts[ALICE.address.toLowerCase()];
      accounts[BOB.address.toLowerCase()] = { userId: "bob", wallets: [OTHER_WALLET.toLowerCase()] };
      const out = await restoreJoins(store, club, backup, userOfWallet, { member });
      assert.equal(out.restored, 0);
      assert.deepEqual(
        out.skipped.map((s) => s.reason),
        ["no account has linked that wallet", "no account has linked that wallet"],
      );
    });

    it("tells a member who is now shown under another wallet to sign again", async () => {
      const backup = [await sign(ALICE)];
      store = memoryStore();
      // Alice now has a second wallet with a shared profile that comes first.
      accounts[ALICE.address.toLowerCase()] = { userId: "alice", wallets: [OTHER_WALLET.toLowerCase(), ALICE.address.toLowerCase()] };
      const out = await restoreJoins(store, club, backup, userOfWallet, { member });
      assert.equal(out.restored, 1);
      assert.deepEqual(out.resign, [ALICE.address]);
      assert.equal(await store.get(joinRecordKey(club.address, "alice")), null, "no proof is kept for a wallet she isn't shown under");
    });

    it("still honours a ban that survived", async () => {
      const { banKey } = await import("../lib/server/clubState");
      const backup = [await sign(ALICE)];
      store = memoryStore();
      await store.set(banKey(club.address), { alice: { wallet: ALICE.address, at: 1, by: "mod" } });
      const out = await restoreJoins(store, club, backup, userOfWallet, { member });
      assert.deepEqual(
        out.skipped.map((s) => s.reason),
        ["can't join: banned"],
      );
    });
  });

  describe("the route", () => {
    const gateAs = (id: string, wallets: string[]) => async (): Promise<UserGate> =>
      ({ store, user: { id, linked_accounts: wallets.map((address) => ({ type: "wallet", chain_type: "ethereum", address })) } }) as unknown as UserGate;
    const ctx = { params: Promise.resolve({ token: NFT }) };
    const put = (body: unknown) => new Request("http://x/api", { method: "PUT", body: JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.9" } });
    const get = () => new Request("http://x/api", { headers: { "x-forwarded-for": "203.0.113.9" } });

    it("PUT keeps the signature and GET says so", async () => {
      const m = membershipHandlers(reg, { gate: gateAs("alice", [ALICE.address]), ...member });
      const before = await (await m.GET(get(), ctx)).json();
      assert.deepEqual({ signed: before.signed, club: before.club }, { signed: false, club: club.address });
      const res = await m.PUT(put(await sign(ALICE)), ctx);
      assert.deepEqual(await res.json(), { enabled: true, signed: true });
      assert.equal((await (await m.GET(get(), ctx)).json()).signed, true);
    });

    it("PUT says why it refused", async () => {
      const m = membershipHandlers(reg, { gate: gateAs("carol", [OTHER_WALLET]), ...member });
      const res = await m.PUT(put(await sign(ALICE)), ctx);
      assert.equal(res.status, 409);
      assert.equal(((await res.json()) as { error: string }).error, "not_member");
      assert.equal((await m.PUT(put({}), ctx)).status, 400);
    });
  });
});
