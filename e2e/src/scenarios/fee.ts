import assert from "node:assert/strict";
import { type Address, type Hex, parseEther, zeroAddress } from "viem";
import { type Case, Warning } from "../lib/report.ts";
import type { Actor, World } from "../lib/world.ts";

const RAISE_DELAY = 7 * 24 * 3600;

/** Both contracts share FeeAdmin; each check runs against both. */
const both = (w: World): [string, Address, World["abi"]["v2"]][] => [
  ["DeClubEscrow", w.v2, w.abi.v2],
  ["DeClubIntents", w.intents, w.abi.intents],
];

const localOnly = (w: World) => (w.target === "local" ? null : "moves the live fee or its admin: local only");
const needAdmin = (w: World) => (w.feeAdmin ? null : "no fee admin key (E2E_FEE_ADMIN_KEY)");

async function setFee(w: World, address: Address, abi: World["abi"]["v2"], fee: bigint) {
  await w.send(w.feeAdmin!, address, abi, "setFee", [fee]);
}

export const feeCases: Case<World>[] = [
  {
    id: "FA-01",
    title: "Only the admin sets the fee, never above the ceiling; both contracts charge the same",
    async run(w, note) {
      const fees: bigint[] = [];
      for (const [name, address, abi] of both(w)) {
        const [fee, max, admin] = await Promise.all([
          w.read<bigint>(address, abi, "fee"),
          w.read<bigint>(address, abi, "MAX_FEE"),
          w.read<Address>(address, abi, "feeAdmin"),
        ]);
        fees.push(fee);
        note(`${name}: fee ${w.fmt(fee)}, ceiling ${w.fmt(max)}, admin ${admin}`);
        assert.ok(fee <= max, `${name}: fee above its ceiling`);
        await w.expectRevert(w.alice, address, abi, "setFee", [0n], "NotFeeAdmin");
        await w.expectRevert(w.alice, address, abi, "renounceFeeAdmin", [], "NotFeeAdmin");
        if (w.feeAdmin) {
          assert.equal(admin, w.feeAdmin.address, `${name}: E2E_FEE_ADMIN_KEY isn't the fee admin`);
          await w.expectRevert(w.feeAdmin, address, abi, "setFee", [max + 1n], "FeeTooHigh");
          if ((await w.read<bigint>(address, abi, "pendingFee")) === 0n) {
            await w.expectRevert(w.feeAdmin, address, abi, "applyFee", [], "NoPendingFee");
          }
        }
      }
      if (fees[0] !== fees[1]) throw new Warning(`the contracts charge different fees (${fees.map(w.fmt).join(" vs ")}): keep them in step`);
    },
  },
  {
    id: "FA-02",
    title: "A raise is queued for 7 days, can't be applied early, and setFee(fee()) cancels it",
    skip: needAdmin,
    async run(w, note) {
      for (const [name, address, abi] of both(w)) {
        const [fee, max] = await Promise.all([w.read<bigint>(address, abi, "fee"), w.read<bigint>(address, abi, "MAX_FEE")]);
        if (fee >= max) {
          note(`${name}: fee is at its ceiling, nothing to raise`);
          continue;
        }
        const t0 = await w.now();
        await setFee(w, address, abi, fee + 1n);
        assert.equal(await w.read<bigint>(address, abi, "pendingFee"), fee + 1n);
        const at = await w.read<bigint>(address, abi, "pendingFeeAt");
        assert.ok(at >= t0 + BigInt(RAISE_DELAY), `${name}: raise applies in under 7 days`);
        assert.equal(await w.read<bigint>(address, abi, "fee"), fee, `${name}: a raise took effect at once`);
        await w.expectRevert(w.feeAdmin!, address, abi, "applyFee", [], "FeeRaiseNotReady");
        await setFee(w, address, abi, fee);
        assert.equal(await w.read<bigint>(address, abi, "pendingFee"), 0n, `${name}: setFee(fee()) didn't cancel the raise`);
        assert.equal(await w.read<bigint>(address, abi, "fee"), fee);
        note(`${name}: queued and cancelled a raise to ${w.fmt(fee + 1n)}`);
      }
    },
  },
  {
    id: "FA-03",
    title: "A cut applies at once; an open deal keeps the fee it was listed with",
    skip: (w) => localOnly(w) ?? needAdmin(w),
    async run(w, note) {
      const old = await w.v2Fee();
      assert.ok(old > 0n, "the local deployment should start with a fee");
      const [before] = await w.mintNfts(w.alice, 1);
      await w.approveAll(w.alice, w.v2);
      const ask = [w.monAsset(parseEther("0.001"))];
      const r1 = await w.send(w.alice, w.v2, w.abi.v2, "createTrade", [[w.nftAsset(before!)], ask, zeroAddress, 0n], old);
      const id1 = w.events<{ tradeId: bigint }>(r1, w.abi.v2, "TradeCreated", w.v2)[0]!.tradeId;

      const cut = old / 2n;
      for (const [, address, abi] of both(w)) await setFee(w, address, abi, cut);
      assert.equal(await w.v2Fee(), cut);
      assert.equal(await w.intentsFee(), cut);

      // The old deal is filled at its own fee, not the new one.
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id1], "WrongNativeAmount", parseEther("0.001") + cut);
      const filled = await w.send(w.bob, w.v2, w.abi.v2, "fillTrade", [id1], parseEther("0.001") + old);
      assert.equal(w.events<{ amount: bigint }>(filled, w.abi.v2, "FeeCharged", w.v2)[0]!.amount, 2n * old);

      const [after] = await w.mintNfts(w.alice, 1);
      const r2 = await w.send(w.alice, w.v2, w.abi.v2, "createTrade", [[w.nftAsset(after!)], ask, zeroAddress, 0n], cut);
      const id2 = w.events<{ tradeId: bigint }>(r2, w.abi.v2, "TradeCreated", w.v2)[0]!.tradeId;
      assert.equal((await w.trade(id2)).fee, cut);
      note(`fee ${w.fmt(old)} → ${w.fmt(cut)}; trade ${id1} kept ${w.fmt(old)}, trade ${id2} listed at ${w.fmt(cut)}`);
    },
  },
  {
    id: "FA-04",
    title: "A raise applies after 7 days; intents signed with the old maxFee are then refused",
    skip: (w) => localOnly(w) ?? needAdmin(w),
    async run(w, note) {
      const old = await w.intentsFee();
      const max = await w.read<bigint>(w.intents, w.abi.intents, "MAX_FEE");
      const raised = old * 2n <= max ? old * 2n : max;
      assert.ok(raised > old, "no room to raise");

      // Signed while the fee is `old`, so maxFee = old.
      const [nftId] = await w.mintNfts(w.alice, 1);
      await w.mintUsd(w.bob, parseEther("1"));
      for (const who of [w.alice, w.bob]) await w.ensureFeeToken(who, raised * 2n);
      await w.approveAll(w.alice, w.intents);
      await w.approveToken(w.bob, w.usd, w.intents);
      const a = await w.intent(w.alice.address, [w.nftAsset(nftId!)], [w.tokenAsset(w.usd, parseEther("1"))], {
        deadline: (await w.now()) + 30n * 24n * 3600n,
      });
      const b = await w.intent(w.bob.address, [w.tokenAsset(w.usd, parseEther("1"))], [w.nftAsset(nftId!)], { deadline: a.deadline });
      const sigs: Hex[] = [await w.sign(w.alice, a), await w.sign(w.bob, b)];

      for (const [, address, abi] of both(w)) await setFee(w, address, abi, raised);
      await w.warp(RAISE_DELAY - 60);
      await w.expectRevert(w.feeAdmin!, w.intents, w.abi.intents, "applyFee", [], "FeeRaiseNotReady");
      await w.warp(120);
      for (const [, address, abi] of both(w)) await w.send(w.feeAdmin!, address, abi, "applyFee");
      assert.equal(await w.intentsFee(), raised);
      assert.equal(await w.v2Fee(), raised);

      await w.expectRevert(w.relayer, w.intents, w.abi.intents, "settle", [[a, b], sigs], "WrongFee");
      note(`fee ${w.fmt(old)} → ${w.fmt(raised)} after 7 days; intents with maxFee ${w.fmt(old)} refused`);
    },
  },
  {
    id: "FA-05",
    title: "Admin handover is two-step; nobody else can accept",
    skip: (w) => localOnly(w) ?? needAdmin(w),
    async run(w) {
      const admin = w.feeAdmin!;
      const hand = async (address: Address, abi: World["abi"]["v2"], from: Actor, to: Actor) => {
        await w.send(from, address, abi, "transferFeeAdmin", [to.address]);
        assert.equal(await w.read<Address>(address, abi, "feeAdmin"), from.address, "the role moved before it was accepted");
        await w.expectRevert(w.carol, address, abi, "acceptFeeAdmin", [], "NotPendingFeeAdmin");
        await w.send(to, address, abi, "acceptFeeAdmin");
        assert.equal(await w.read<Address>(address, abi, "feeAdmin"), to.address);
      };
      for (const [, address, abi] of both(w)) {
        await hand(address, abi, admin, w.bob);
        await w.expectRevert(admin, address, abi, "setFee", [0n], "NotFeeAdmin");
        await hand(address, abi, w.bob, admin);
      }
    },
  },
];
