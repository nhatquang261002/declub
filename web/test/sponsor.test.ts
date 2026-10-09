import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getAddress, type Address, type Hex } from "viem";
import type { MemberRow } from "../lib/members";
import { SPONSOR_MIN_WEI, sponsorMessage } from "../lib/rewards";
import { rolesKey } from "../lib/server/clubState";
import { memberKey, membersKey } from "../lib/server/members";
import { lastKey, recordSponsor, removeSponsor } from "../lib/server/rewards";
import { restoreSponsors, sponsorHandler, sponsorInfoHandler, sponsorTxKey, type Payment, type SponsorDeps } from "../lib/server/sponsorRoutes";
import { exportSponsors, readSponsors, sponsorsByClub } from "../lib/server/sponsors";
import { memoryStore, type Store } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const ETH = 10n ** 18n;
const NFT: Address = getAddress("0x220a2c52fd27252e7cd6163a7bf1b6ae159d26e4");
const OPERATOR: Address = getAddress("0x00000000000000000000000000000000000000a0");
const PAYER: Address = getAddress("0xaaaa000000000000000000000000000000000001");
const OWNER_WALLET: Address = getAddress("0xbbbb000000000000000000000000000000000002");
const GENESIS = 1_800_000_000;
const WEEK = 604_800;
const TX = `0x${"11".repeat(32)}` as Hex;
const TX2 = `0x${"22".repeat(32)}` as Hex;
const SIG = `0x${"ab".repeat(65)}` as Hex;

const registry = makeRegistry(
  parseAssets([{ chainId: 10143, address: NFT, kind: "erc721", name: "Mock Chog", symbol: "MCHOG", status: "verified", note: "x" }]),
);
const params = <T>(value: T) => ({ params: Promise.resolve(value) });
const post = (body: unknown) => new Request("http://localhost/api/clubs/x/sponsor", { method: "POST", body: JSON.stringify(body) });

describe("sponsoring from the app (ADR 0036)", () => {
  let store: Store;
  let payments: Map<string, Payment>;
  let signed: boolean;
  let verified: { address: Address; message: string }[];
  let deps: SponsorDeps;
  const POST = () => sponsorHandler(registry, deps);
  const send = (body: Record<string, unknown>) => POST()(post(body), params({ token: NFT }));
  const good = (over: Partial<Payment> = {}): Payment => ({ from: PAYER, to: OPERATOR, value: 5n * ETH, ok: true, at: GENESIS + 100, ...over });

  beforeEach(() => {
    store = memoryStore();
    payments = new Map([[TX, good()]]);
    signed = true;
    verified = [];
    deps = {
      store: () => store,
      now: () => GENESIS + 200,
      operator: async () => OPERATOR,
      payment: async (hash) => payments.get(hash) ?? null,
      verify: async ({ address, message }) => (verified.push({ address, message }), signed),
      genesis: GENESIS,
      length: WEEK,
    };
  });

  it("records a payment to the operator under the signed name, in the epoch of its block", async () => {
    const res = await send({ tx: TX, name: "  Monad   Foundation ", signature: SIG });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, already: false, epoch: 0, amount: (5n * ETH).toString(), sponsor: "Monad Foundation", kind: "partner" });
    assert.deepEqual(verified, [{ address: PAYER, message: sponsorMessage(NFT, TX, "Monad Foundation") }]);
    const [entry] = await readSponsors(store, 0);
    assert.deepEqual(
      { club: entry!.club, by: entry!.by, tx: entry!.tx, kind: entry!.kind },
      { club: NFT.toLowerCase(), by: PAYER.toLowerCase(), tx: TX, kind: "partner" },
    );
  });

  it("takes the amount from the chain, never from the request", async () => {
    await send({ tx: TX, name: "A", signature: SIG, amount: "999000000000000000000" });
    assert.equal((await readSponsors(store, 0))[0]!.amount, (5n * ETH).toString());
  });

  it("answers a payment it already took the same way, and counts it once", async () => {
    await send({ tx: TX, name: "A", signature: SIG });
    const again = await send({ tx: TX, name: "Someone else", signature: SIG });
    assert.deepEqual(await again.json(), { ok: true, already: true, epoch: 0, amount: (5n * ETH).toString(), sponsor: "A", kind: "partner" });
    assert.equal((await readSponsors(store, 0)).length, 1);
  });

  it("labels the Owner's own top-up", async () => {
    const row: MemberRow = {
      userId: "uo",
      wallets: [OWNER_WALLET.toLowerCase()],
      displayWallet: OWNER_WALLET.toLowerCase(),
      holder: true,
      holderCheckedAt: 1,
      joinedAt: 1,
    };
    await store.set(memberKey(NFT, "uo"), row);
    await store.addMember(membersKey(NFT), "uo");
    await store.set(rolesKey(NFT), { owner: "uo", moderators: [] });
    payments.set(TX2, good({ from: OWNER_WALLET }));
    const res = await send({ tx: TX2, name: "Chog team", signature: SIG });
    assert.equal(((await res.json()) as { kind: string }).kind, "owner");
  });

  it("refuses what the chain doesn't back: wrong recipient, too small, failed, unknown, bad signature", async () => {
    const refuse = async (payment: Payment | null, body: Record<string, unknown>, status: number, error: string) => {
      payments = new Map(payment ? [[TX, payment]] : []);
      const res = await send({ tx: TX, name: "A", signature: SIG, ...body });
      assert.equal(res.status, status);
      assert.equal(((await res.json()) as { error: string }).error, error);
    };
    await refuse(good({ to: PAYER }), {}, 422, "wrong_recipient");
    await refuse(good({ to: null }), {}, 422, "wrong_recipient");
    await refuse(good({ value: SPONSOR_MIN_WEI - 1n }), {}, 422, "too_small");
    await refuse(good({ ok: false }), {}, 422, "failed");
    await refuse(null, {}, 422, "not_found");
    signed = false;
    await refuse(good(), {}, 422, "bad_signature");
    signed = true;
    await refuse(good(), { name: "   " }, 400, "bad_request");
    await refuse(good(), { tx: "0x12" }, 400, "bad_request");
    await refuse(good(), { signature: "nope" }, 400, "bad_request");
    assert.deepEqual(await readSponsors(store, 0), [], "nothing was recorded");
    assert.equal(await store.get(sponsorTxKey(TX)), null, "and a refused payment can still be recorded later");
  });

  it("puts a payment in the next epoch when its own is already built, so the money isn't lost", async () => {
    await store.set(lastKey(), 0);
    await store.set("declub:rewards:10143:epoch:0", { n: 0 });
    const res = await send({ tx: TX, name: "A", signature: SIG });
    assert.equal(((await res.json()) as { epoch: number }).epoch, 1);
    assert.equal((await readSponsors(store, 1)).length, 1);
  });

  it("404s for an asset with no Club, and says sponsoring is off without an operator or a store", async () => {
    assert.equal((await POST()(post({}), params({ token: "0x00000000000000000000000000000000000000ff" }))).status, 404);
    deps = { ...deps, operator: async () => null };
    assert.equal((await send({ tx: TX, name: "A", signature: SIG })).status, 503);
    deps = { ...deps, store: () => null };
    assert.equal((await send({ tx: TX, name: "A", signature: SIG })).status, 503);
  });

  it("serves where to send the money and the least that can be sent", async () => {
    const info = await sponsorInfoHandler(registry, deps)(new Request("http://localhost"), params({ token: NFT }));
    assert.deepEqual(await info.json(), { enabled: true, to: OPERATOR, min: SPONSOR_MIN_WEI.toString(), epoch: 0, endsAt: GENESIS + WEEK });
    const off = await sponsorInfoHandler(registry, { ...deps, store: () => null })(new Request("http://localhost"), params({ token: NFT }));
    assert.equal(((await off.json()) as { enabled: boolean }).enabled, false);
  });

  it("never loses a sponsorship written at the same moment as another", async () => {
    const results = await Promise.all([1, 2, 3].map((i) => recordSponsor(store, 0, { club: NFT, amount: BigInt(i) * ETH, sponsor: `S${i}`, kind: "partner" })));
    const recorded = results.filter((r) => r.status === "recorded").length;
    assert.ok(recorded >= 1);
    assert.equal((await readSponsors(store, 0)).length, recorded, "every one reported as recorded is in the ledger");
    assert.ok(results.every((r) => r.status === "recorded" || r.status === "busy"));
  });

  it("lets the operator remove a name before the epoch is built, but not after", async () => {
    await send({ tx: TX, name: "Rude", signature: SIG });
    assert.equal((await removeSponsor(store, 0, "0x" + "33".repeat(32))).status, "missing");
    const out = await removeSponsor(store, 0, TX.toUpperCase().replace("0X", "0x"));
    assert.equal(out.status, "removed");
    assert.deepEqual(await readSponsors(store, 0), []);
    const again = await send({ tx: TX, name: "Rude", signature: SIG });
    assert.equal(((await again.json()) as { already: boolean }).already, true, "the payment stays taken: it isn't added again");
    await store.set("declub:rewards:10143:epoch:0", { n: 0 });
    assert.equal((await removeSponsor(store, 0, TX)).status, "built");
  });

  describe("backup and restore (ADR 0053)", () => {
    it("keeps the sponsor's signature with the payment, and never publishes it", async () => {
      await send({ tx: TX, name: "A", signature: SIG });
      const [entry] = await readSponsors(store, 0);
      assert.equal(entry!.signature, SIG);
      const published = sponsorsByClub([entry!]).get(NFT.toLowerCase())!.sponsors;
      assert.ok(!JSON.stringify(published).includes(SIG), "the epoch record and the Rewards tab carry no signature");
    });

    it("rebuilds the ledger from an export after the store is lost", async () => {
      await send({ tx: TX, name: "Monad Foundation", signature: SIG });
      const { records, unsigned } = await exportSponsors(store, 0, 3);
      assert.deepEqual(records, [{ epoch: 0, club: NFT.toLowerCase(), tx: TX, name: "Monad Foundation", signature: SIG }]);
      assert.deepEqual(unsigned, []);

      const before = (await readSponsors(store, 0))[0]!;
      store = memoryStore();
      const out = await restoreSponsors(store, registry, records, deps);
      assert.deepEqual(out, { restored: 1, skipped: [] });
      const after = (await readSponsors(store, 0))[0]!;
      assert.deepEqual({ ...after, at: 0 }, { ...before, at: 0 });
      assert.equal(((await store.get(sponsorTxKey(TX))) as { epoch: number }).epoch, 0, "the payment is marked taken again");
    });

    it("puts a payment back in the epoch it was in, even when later epochs are built", async () => {
      await send({ tx: TX, name: "A", signature: SIG });
      const { records } = await exportSponsors(store, 0, 3);
      store = memoryStore();
      await store.set(lastKey(), 0);
      // `last` says epoch 0 is built, so a new payment would go to 1; a restore keeps it where it was.
      const out = await restoreSponsors(store, registry, records, deps);
      assert.equal(out.restored, 1);
      assert.equal((await readSponsors(store, 0)).length, 1);
    });

    it("counts a payment once however often it is restored", async () => {
      await send({ tx: TX, name: "A", signature: SIG });
      const { records } = await exportSponsors(store, 0, 0);
      const again = await restoreSponsors(store, registry, records, deps);
      assert.deepEqual(again.skipped, [{ tx: TX, reason: "already recorded" }]);
      store = memoryStore();
      await restoreSponsors(store, registry, records, deps);
      await store.del(sponsorTxKey(TX));
      await restoreSponsors(store, registry, records, deps);
      assert.equal((await readSponsors(store, 0)).length, 1, "even if the taken-marker is gone, the ledger doesn't double");
    });

    it("adds nothing the chain and the signature don't back", async () => {
      const forged = [
        { epoch: 0, club: NFT, tx: TX, name: "A", signature: SIG },
        { epoch: 0, club: NFT, tx: TX2, name: "Not paid", signature: SIG },
        { epoch: 0, club: "0x00000000000000000000000000000000000000ff", tx: TX, name: "No Club", signature: SIG },
        { epoch: -1, club: NFT, tx: TX, name: "A", signature: SIG },
        { epoch: 0, club: NFT, tx: "0x12", name: "A", signature: SIG },
        { epoch: 0, club: NFT, tx: TX, name: "   ", signature: SIG },
      ];
      signed = false;
      const out = await restoreSponsors(store, registry, forged, deps);
      assert.equal(out.restored, 0);
      assert.equal(out.skipped.length, forged.length);
      assert.deepEqual(await readSponsors(store, 0), []);
    });

    it("lists entries it can't restore from the chain instead of dropping them", async () => {
      await recordSponsor(store, 0, { club: NFT, amount: ETH, sponsor: "By hand", kind: "partner" });
      const { records, unsigned } = await exportSponsors(store, 0, 0);
      assert.deepEqual(records, []);
      assert.equal(unsigned[0]!.sponsor, "By hand");
    });
  });
});
