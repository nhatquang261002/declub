import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { readFee } from "../src/chain.ts";
import { Matcher, defaultMatcherConfig } from "../src/matcher.ts";
import { Pool } from "../src/pool.ts";
import { Store } from "../src/store.ts";
import type { Asset } from "../src/types.ts";
import { type World, CHAIN_ID, FEE, FEE_RAISE_DELAY, skipReason, startWorld } from "./harness.ts";

const skip = skipReason() ?? false;
const ONE = 10n ** 18n;
const DAY = 24 * 60 * 60;

/**
 * The fee admin changing the fee under a live pool (ADR 0018). A world of its own: a raise moves
 * the chain's clock a week ahead, so intents here run for two weeks, in a pool that allows it, and
 * the pool is told the chain's time.
 */
describe("a fee change under a live pool", { skip }, () => {
  let w: World;
  let store: Store;
  let pool: Pool;
  let matcher: Matcher;
  /** The chain's clock, in ms, which runs ahead of the wall clock after a raise. */
  let chainNow: () => Promise<number>;

  before(async () => {
    w = await startWorld();
    chainNow = async () => Number((await w.reader.getBlock()).timestamp) * 1000;
  });
  after(() => w?.stop());
  beforeEach(() => {
    store = new Store();
    pool = new Pool(store, w.reader, {
      chainId: CHAIN_ID,
      swap: w.swap,
      feeToken: w.wmon,
      minTtlSec: 60,
      maxTtlSec: 30 * DAY,
    });
    matcher = new Matcher(pool, w.matcherSender, defaultMatcherConfig(w.swap));
  });

  /** Alice sells a fresh Chog for 3 mUSD, Bob buys it, both signed at the fee in force. */
  async function postPair() {
    const now = await chainNow();
    const deadline = BigInt(Math.floor(now / 1000) + 14 * DAY);
    const maxFee = await readFee(w.reader, w.swap);
    const [id] = await w.mintChogs(w.alice.address, 1);
    await w.approveChog(w.alice, id!);
    await w.mintToken(w.usd, w.bob.address, 3n * ONE);
    await w.approveToken(w.bob, w.usd, 3n * ONE);
    const sell = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, 3n * ONE)], { deadline, maxFee });
    const buy = w.intent(w.bob.address, [w.tokenOf(w.usd, 3n * ONE) as Asset], [w.chogOf(id!)], { deadline, maxFee });
    const a = await pool.submit(await w.body(w.alice, sell), now);
    const b = await pool.submit(await w.body(w.bob, buy), now);
    return [a.hash, b.hash] as const;
  }

  it("reads the fee from the contract, not from its config", async () => {
    assert.equal(await readFee(w.reader, w.swap), FEE);
  });

  it("settles intents signed before a cut, and charges the new fee", async () => {
    await postPair();
    await w.setFee(FEE / 2n);
    const paidBefore = await w.balanceOf(w.wmon, w.feeRecipient);
    const aliceBefore = await w.balanceOf(w.wmon, w.alice.address);

    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 1);
    assert.equal(await w.balanceOf(w.wmon, w.alice.address), aliceBefore - FEE / 2n);
    assert.equal(await w.balanceOf(w.wmon, w.feeRecipient), paidBefore + FEE);
    await w.setFee(FEE); // back up for the next test (a raise: the clock moves a week)
  });

  it("charges a maker the fee for every NFT they give (ADR 0033)", async () => {
    await w.setFee(FEE);
    const now = await chainNow();
    const deadline = BigInt(Math.floor(now / 1000) + 14 * DAY);
    const ids = await w.mintChogs(w.alice.address, 3);
    for (const id of ids) await w.approveChog(w.alice, id);
    await w.mintToken(w.usd, w.bob.address, 3n * ONE);
    await w.approveToken(w.bob, w.usd, 3n * ONE);
    const sell = w.intent(w.alice.address, ids.map((id) => w.chogOf(id)), [w.tokenOf(w.usd, 3n * ONE)], { deadline, maxFee: FEE });
    const buy = w.intent(w.bob.address, [w.tokenOf(w.usd, 3n * ONE) as Asset], ids.map((id) => w.chogOf(id)), { deadline, maxFee: FEE });
    await pool.submit(await w.body(w.alice, sell), now);
    await pool.submit(await w.body(w.bob, buy), now);
    const aliceBefore = await w.balanceOf(w.wmon, w.alice.address);
    const bobBefore = await w.balanceOf(w.wmon, w.bob.address);
    const paidBefore = await w.balanceOf(w.wmon, w.feeRecipient);

    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 1);
    assert.equal(await w.balanceOf(w.wmon, w.alice.address), aliceBefore - 3n * FEE); // three NFTs
    assert.equal(await w.balanceOf(w.wmon, w.bob.address), bobBefore - FEE); // none, so one
    assert.equal(await w.balanceOf(w.wmon, w.feeRecipient), paidBefore + 4n * FEE);
  });

  it("checks a maker holds the fee for every NFT they give before taking the intent", async () => {
    await w.setFee(FEE);
    const now = await chainNow();
    const ids = await w.mintChogs(w.alice.address, 3);
    for (const id of ids) await w.approveChog(w.alice, id);
    // Leave alice enough WMON for two NFTs' fees, not three.
    const balance = await w.balanceOf(w.wmon, w.alice.address);
    await w.transferToken(w.alice, w.wmon, w.carol.address, balance - 2n * FEE);

    const sell = w.intent(w.alice.address, ids.map((id) => w.chogOf(id)), [w.tokenOf(w.usd, ONE)], {
      deadline: BigInt(Math.floor(now / 1000) + DAY),
      maxFee: FEE,
    });
    await assert.rejects(
      pool.submit(await w.body(w.alice, sell), now),
      (e: { code?: string }) => e.code === "fee_balance",
    );
    await w.transferToken(w.carol, w.wmon, w.alice.address, balance - 2n * FEE); // put it back
  });

  it("refuses new intents signed below the fee after a raise", async () => {
    // The previous test raised it back to FEE; go above.
    await w.setFee(FEE + ONE);
    const [id] = await w.mintChogs(w.alice.address, 1);
    await w.approveChog(w.alice, id!);
    const now = await chainNow();
    const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)], {
      deadline: BigInt(Math.floor(now / 1000) + DAY),
      maxFee: FEE,
    });
    await assert.rejects(
      pool.submit(await w.body(w.alice, intent), now),
      (e: { code?: string }) => e.code === "wrong_fee",
    );
    await w.setFee(FEE); // a cut: applies at once
  });

  it("parks intents a raise priced out as stale, without blaming their makers, and revives them on a cut", async () => {
    const [a, b] = await postPair(); // signed at FEE
    await w.setFee(FEE + ONE);

    // The matcher may try them before the next prune. The contract names the first intent in the
    // cycle that its fee check fails, and the simulation's WrongFee parks that one.
    const report = await matcher.runOnce();
    assert.equal(report.settled.length, 0);
    assert.equal(report.dropped.length, 1);
    assert.ok([a, b].includes(report.dropped[0]!.hash));
    assert.equal(report.dropped[0]!.status, "stale");
    assert.equal(report.dropped[0]!.reason, "WrongFee");
    for (const who of [w.alice, w.bob]) {
      assert.equal(store.failureCount(who.address, 0), 0, "a fee raise isn't the maker's doing");
    }

    // The next prune parks the rest, and says why in the pool's own words.
    await pool.prune(await chainNow());
    for (const h of [a, b]) {
      assert.equal(store.get(h)!.status, "stale");
      assert.match(store.get(h)!.reason ?? "", /^wrong_fee: the fee is \d+, above the signed maxFee \d+/);
    }

    // Cut back to what they signed: the next prune revives them and they settle.
    await w.setFee(FEE);
    await pool.prune(await chainNow());
    assert.equal(store.get(a)!.status, "open");
    assert.equal(store.get(b)!.status, "open");
    const settled = await matcher.runOnce();
    assert.equal(settled.settled.length, 1);
  });

  it("still waits for a queued raise: until it is applied, nothing changes", async () => {
    await w.setFee(FEE);
    await postPair();
    // Queue a raise but don't apply it: the fee in force is still FEE.
    const { request } = await w.reader.simulateContract({
      account: w.feeAdmin.account,
      address: w.swap,
      abi: [{ type: "function", name: "setFee", inputs: [{ name: "newFee", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }],
      functionName: "setFee",
      args: [FEE + ONE],
    });
    await w.tx(w.feeAdmin.wallet.writeContract(request));
    await w.increaseTime(FEE_RAISE_DELAY);

    assert.equal(await readFee(w.reader, w.swap), FEE);
    const report = await matcher.runOnce();
    assert.equal(report.settled.length, 1);
  });
});
