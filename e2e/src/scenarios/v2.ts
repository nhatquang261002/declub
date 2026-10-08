import assert from "node:assert/strict";
import { type Address, type Hex, parseEther, zeroAddress } from "viem";
import type { Case } from "../lib/report.ts";
import { ERC721_TRAIT, ProposalStatus, Status, type Asset, type World } from "../lib/world.ts";

const USD = (n: number) => parseEther(String(n));
const MON = (n: string) => parseEther(n);

/** What a side's fee is multiplied by (ADR 0033): its NFTs, a trait set counting its amount, and at least one. */
const feeUnits = (assets: Asset[]) => {
  const nfts = assets.reduce((n, a) => n + (a.assetType === 2 ? 1n : a.assetType === ERC721_TRAIT ? a.amount : 0n), 0n);
  return nfts === 0n ? 1n : nfts;
};

/** Create a deal and return its id (from `TradeCreated`). */
async function create(w: World, who: World["alice"], fn: "createTrade" | "createOpenOffer" | "createTraitTrade", args: unknown[], offered: Asset[]) {
  const fee = await w.v2Fee();
  const value = offered.filter((a) => a.assetType === 0).reduce((s, a) => s + a.amount, 0n) + fee * feeUnits(offered);
  const receipt = await w.send(who, w.v2, w.abi.v2, fn, args, value);
  const [ev] = w.events<{ tradeId: bigint }>(receipt, w.abi.v2, "TradeCreated", w.v2);
  assert.ok(ev, "no TradeCreated event");
  return { id: ev.tradeId, receipt, fee };
}

/** MON owed by the side paying `assets`, plus the deal's fee share: its fee per NFT, once for each. */
const owed = (assets: Asset[], fee: bigint) => assets.filter((a) => a.assetType === 0).reduce((s, a) => s + a.amount, 0n) + fee * feeUnits(assets);

async function expiry(w: World, sec = 3600) {
  return (await w.now()) + BigInt(sec);
}

/** Alice's one NFT, approved for escrow and offered for 0.001 MON: the plain deal most of these cases start from. */
async function nftForMon(w: World) {
  const [nftId] = await w.mintNfts(w.alice, 1);
  await w.approveAll(w.alice, w.v2);
  return { nftId: nftId!, offered: [w.nftAsset(nftId!)], requested: [w.monAsset(MON("0.001"))] };
}

type MerkleSet = { root: Hex; proofs: Map<bigint, Hex[]>; count: number };
/**
 * The app's own Merkle builder (web/lib/merkle.ts), so the proofs the create flow makes are the
 * ones checked on-chain. Loaded at run time: web/ is a separate TypeScript project.
 */
async function appMerkle(): Promise<(ids: readonly bigint[], collection: Address) => MerkleSet> {
  const path: string = "../../../web/lib/merkle.ts";
  const mod = (await import(path)) as { buildMerkleSet: (ids: readonly bigint[], collection: Address) => MerkleSet };
  return mod.buildMerkleSet;
}

export const v2Cases: Case<World>[] = [
  {
    id: "V2-01",
    title: "Exact swap: NFT for ERC-20 + MON, filled by anyone; fee from both sides",
    async run(w, note) {
      const [nftId] = await w.mintNfts(w.alice, 1);
      await w.approveAll(w.alice, w.v2);
      await w.mintUsd(w.bob, USD(50));
      await w.approveToken(w.bob, w.usd, w.v2);

      const offered = [w.nftAsset(nftId!)];
      const requested = [w.tokenAsset(w.usd, USD(50)), w.monAsset(MON("0.01"))];
      const { id, fee } = await create(w, w.alice, "createTrade", [offered, requested, zeroAddress, await expiry(w)], offered);
      assert.equal(await w.ownerOf(nftId!), w.v2, "NFT not in escrow");
      const t = await w.trade(id);
      assert.equal(t.status, Status.Open);
      assert.equal(t.fee, fee, "deal didn't record the fee in force");

      const aliceUsd = await w.balanceOf(w.usd, w.alice.address);
      const aliceMon = await w.monOf(w.alice.address);
      const receipt = await w.send(w.bob, w.v2, w.abi.v2, "fillTrade", [id], owed(requested, fee));
      note(`trade ${id}, fill gas ${receipt.gasUsed}, fee ${w.fmt(fee)} MON per side, tx ${receipt.transactionHash}`);

      assert.equal(await w.ownerOf(nftId!), w.bob.address, "NFT didn't reach the taker");
      assert.equal((await w.balanceOf(w.usd, w.alice.address)) - aliceUsd, USD(50), "maker didn't get the ERC-20");
      assert.equal((await w.monOf(w.alice.address)) - aliceMon, MON("0.01"), "maker didn't get the MON");
      assert.equal((await w.trade(id)).status, Status.Filled);
      if (fee > 0n) {
        const [charged] = w.events<{ recipient: Address; amount: bigint }>(receipt, w.abi.v2, "FeeCharged", w.v2);
        assert.ok(charged, "no FeeCharged event");
        assert.equal(charged.recipient, w.feeRecipient);
        assert.equal(charged.amount, 2n * fee, "fee should be both sides' share");
      }
    },
  },
  {
    id: "V2-02",
    title: "Cancel returns the NFT, ERC-20, MON and the fee share",
    async run(w, note) {
      const [nftId] = await w.mintNfts(w.alice, 1);
      await w.approveAll(w.alice, w.v2);
      await w.mintUsd(w.alice, USD(10));
      await w.approveToken(w.alice, w.usd, w.v2);
      const offered = [w.nftAsset(nftId!), w.tokenAsset(w.usd, USD(10)), w.monAsset(MON("0.02"))];
      const usdBefore = await w.balanceOf(w.usd, w.alice.address);
      const escrowBefore = await w.monOf(w.v2);
      const { id, fee } = await create(w, w.alice, "createTrade", [offered, [w.tokenAsset(w.feeToken, 1n)], zeroAddress, await expiry(w)], offered);
      if (w.target === "local") assert.equal((await w.monOf(w.v2)) - escrowBefore, MON("0.02") + fee, "escrow didn't hold MON + fee");

      await w.expectRevert(w.bob, w.v2, w.abi.v2, "cancelTrade", [id], "NotMaker");
      const receipt = await w.send(w.alice, w.v2, w.abi.v2, "cancelTrade", [id]);
      note(`trade ${id}, cancel gas ${receipt.gasUsed}`);

      assert.equal(await w.ownerOf(nftId!), w.alice.address);
      assert.equal(await w.balanceOf(w.usd, w.alice.address), usdBefore);
      if (w.target === "local") assert.equal(await w.monOf(w.v2), escrowBefore, "MON + fee not refunded");
      assert.equal((await w.trade(id)).status, Status.Cancelled);
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id], "TradeNotOpen", fee);
    },
  },
  {
    id: "V2-03",
    title: "Expiry: a late fill reverts and anyone returns the escrow to the maker",
    async run(w, note) {
      const { nftId, offered, requested } = await nftForMon(w);
      const ttl = 20;
      const { id, fee } = await create(w, w.alice, "createTrade", [offered, requested, zeroAddress, await expiry(w, ttl)], offered);
      await w.expectRevert(w.carol, w.v2, w.abi.v2, "reclaimExpired", [id], "TradeNotExpired");

      await w.warp(ttl + 2);
      assert.equal(await w.read<boolean>(w.v2, w.abi.v2, "isExpired", [id]), true);
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id], "TradeIsExpired", owed(requested, fee));
      const receipt = await w.send(w.carol, w.v2, w.abi.v2, "reclaimExpired", [id]);
      note(`trade ${id}, reclaimed by a third party, gas ${receipt.gasUsed}`);
      assert.equal(await w.ownerOf(nftId), w.alice.address);
      assert.equal((await w.trade(id)).status, Status.Cancelled);
    },
  },
  {
    id: "V2-04",
    title: "Private deal: only the named taker can fill",
    async run(w, note) {
      const { nftId, offered, requested } = await nftForMon(w);
      const { id, fee } = await create(w, w.alice, "createTrade", [offered, requested, w.bob.address, await expiry(w)], offered);
      await w.expectRevert(w.carol, w.v2, w.abi.v2, "fillTrade", [id], "NotAllowedTaker", owed(requested, fee));
      const receipt = await w.send(w.bob, w.v2, w.abi.v2, "fillTrade", [id], owed(requested, fee));
      note(`trade ${id}, fill gas ${receipt.gasUsed}`);
      assert.equal(await w.ownerOf(nftId), w.bob.address);
    },
  },
  {
    id: "V2-05",
    title: "Open offer: two proposals, reject one, accept one; a third is withdrawn",
    async run(w, note) {
      const [offerNft] = await w.mintNfts(w.alice, 1);
      await w.approveAll(w.alice, w.v2);
      const [bobNft] = await w.mintNfts(w.bob, 1);
      await w.approveAll(w.bob, w.v2);
      await w.mintUsd(w.carol, USD(25));
      await w.approveToken(w.carol, w.usd, w.v2);
      const [daveNft] = await w.mintNfts(w.dave, 1);
      await w.approveAll(w.dave, w.v2);

      const offered = [w.nftAsset(offerNft!)];
      const noteText = "e2e: looking for mUSD or another Chog";
      const { id, fee } = await create(w, w.alice, "createOpenOffer", [offered, zeroAddress, await expiry(w), noteText], offered);
      assert.equal(await w.read<string>(w.v2, w.abi.v2, "offerNote", [id]), noteText);
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id], "OpenOfferNoFill", fee);
      await w.expectRevert(w.alice, w.v2, w.abi.v2, "propose", [id, [w.monAsset(1n)]], "SelfPropose", 1n + fee);

      const propose = async (who: World["alice"], assets: Asset[]) => {
        const r = await w.send(who, w.v2, w.abi.v2, "propose", [id, assets], owed(assets, fee));
        const [ev] = w.events<{ proposalId: bigint }>(r, w.abi.v2, "ProposalCreated", w.v2);
        return ev!.proposalId;
      };
      const pBob = await propose(w.bob, [w.nftAsset(bobNft!)]);
      const pCarol = await propose(w.carol, [w.tokenAsset(w.usd, USD(25))]);
      const pDave = await propose(w.dave, [w.nftAsset(daveNft!)]);
      assert.equal(await w.read<bigint>(w.v2, w.abi.v2, "proposalCount", [id]), 3n);

      await w.expectRevert(w.carol, w.v2, w.abi.v2, "rejectProposal", [id, pBob], "NotMaker");
      await w.send(w.alice, w.v2, w.abi.v2, "rejectProposal", [id, pBob]);
      assert.equal(await w.ownerOf(bobNft!), w.bob.address, "rejected proposal not refunded");

      await w.expectRevert(w.bob, w.v2, w.abi.v2, "withdrawProposal", [id, pDave], "NotProposer");
      await w.send(w.dave, w.v2, w.abi.v2, "withdrawProposal", [id, pDave]);
      assert.equal(await w.ownerOf(daveNft!), w.dave.address, "withdrawn proposal not refunded");

      const aliceUsd = await w.balanceOf(w.usd, w.alice.address);
      const receipt = await w.send(w.alice, w.v2, w.abi.v2, "acceptProposal", [id, pCarol]);
      note(`trade ${id}, accept gas ${receipt.gasUsed}`);
      assert.equal(await w.ownerOf(offerNft!), w.carol.address);
      assert.equal((await w.balanceOf(w.usd, w.alice.address)) - aliceUsd, USD(25));
      const statuses = await Promise.all(
        [pBob, pCarol, pDave].map(async (p) => (await w.read<{ status: number }>(w.v2, w.abi.v2, "getProposal", [id, p])).status),
      );
      assert.deepEqual(statuses, [ProposalStatus.Rejected, ProposalStatus.Accepted, ProposalStatus.Withdrawn]);
      assert.equal((await w.trade(id)).status, Status.Filled);
    },
  },
  {
    id: "V2-06",
    title: "Trait deal: a Merkle set from the app's builder; a token outside it is refused",
    async run(w, note) {
      await w.mintUsd(w.alice, USD(30));
      await w.approveToken(w.alice, w.usd, w.v2);
      const bobIds = await w.mintNfts(w.bob, 3);
      const [outsider] = await w.mintNfts(w.bob, 1);
      await w.approveAll(w.bob, w.v2);

      // "Any one of these three", as the create flow builds it from a trait scan.
      const set = (await appMerkle())(bobIds, w.nft);
      const offered = [w.tokenAsset(w.usd, USD(30))];
      const requested: Asset[] = [{ assetType: ERC721_TRAIT, token: w.nft, id: BigInt(set.root), amount: 1n }];
      const spec = `e2e: any of ${bobIds.join(", ")}`;
      const { id, fee } = await create(w, w.alice, "createTraitTrade", [offered, requested, zeroAddress, await expiry(w), spec], offered);
      assert.equal(await w.read<string>(w.v2, w.abi.v2, "traitSpec", [id]), spec);
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id], "TraitFillRequired", fee);

      const pick = bobIds[1]!;
      const proof = set.proofs.get(pick)!;
      // A real proof for a token the set doesn't hold.
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTraitTrade", [id, [{ tokenIds: [outsider!], proofs: [proof] }]], "InvalidTraitProof", fee);
      const receipt = await w.send(w.bob, w.v2, w.abi.v2, "fillTraitTrade", [id, [{ tokenIds: [pick], proofs: [proof] }]], fee);
      note(`trade ${id}, set of ${set.count}, fill gas ${receipt.gasUsed}`);
      assert.equal(await w.ownerOf(pick), w.alice.address);
      assert.equal((await w.trade(id)).status, Status.Filled);
    },
  },
  {
    id: "V2-07",
    title: "Multi-asset deal: 3 NFTs + ERC-20 + MON for 2 NFTs + another ERC-20",
    async run(w, note) {
      const aliceIds = await w.mintNfts(w.alice, 3);
      const bobIds = await w.mintNfts(w.bob, 2);
      await w.approveAll(w.alice, w.v2);
      await w.approveAll(w.bob, w.v2);
      await w.mintUsd(w.alice, USD(5));
      await w.approveToken(w.alice, w.usd, w.v2);
      // MON is one asset, so it can't be on both sides: the other side pays in WMON.
      await w.ensureFeeToken(w.bob, MON("0.004"));
      await w.approveToken(w.bob, w.feeToken, w.v2);

      const offered = [...aliceIds.map((i) => w.nftAsset(i)), w.tokenAsset(w.usd, USD(5)), w.monAsset(MON("0.003"))];
      const requested = [...bobIds.map((i) => w.nftAsset(i)), w.tokenAsset(w.feeToken, MON("0.004"))];
      const { id, fee, receipt: created } = await create(w, w.alice, "createTrade", [offered, requested, zeroAddress, await expiry(w)], offered);
      const filled = await w.send(w.bob, w.v2, w.abi.v2, "fillTrade", [id], owed(requested, fee));
      note(`trade ${id}, create gas ${created.gasUsed}, fill gas ${filled.gasUsed}`);
      if (fee > 0n) {
        // Alice gave 3 NFTs and Bob 2, and each pays the fee for every NFT (ADR 0033).
        const [charged] = w.events<{ amount: bigint }>(filled, w.abi.v2, "FeeCharged", w.v2);
        assert.equal(charged?.amount, 5n * fee, "fee should be 5 NFTs × fee");
      }
      for (const i of aliceIds) assert.equal(await w.ownerOf(i), w.bob.address);
      for (const i of bobIds) assert.equal(await w.ownerOf(i), w.alice.address);
    },
  },
  {
    id: "V2-08",
    title: "Guards: self-fill, wrong MON amount, duplicate asset, past expiry, unsolicited MON",
    async run(w) {
      const { nftId, offered, requested } = await nftForMon(w);
      const { id, fee } = await create(w, w.alice, "createTrade", [offered, requested, zeroAddress, await expiry(w)], offered);

      await w.expectRevert(w.alice, w.v2, w.abi.v2, "fillTrade", [id], "SelfFill", owed(requested, fee));
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id], "WrongNativeAmount", owed(requested, fee) - 1n);
      await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id], "WrongNativeAmount", owed(requested, fee) + 1n);
      if (fee > 0n) {
        // Forgetting the fee share is the mistake a client would make.
        await w.expectRevert(w.bob, w.v2, w.abi.v2, "fillTrade", [id], "WrongNativeAmount", MON("0.001"));
      }

      const [other] = await w.mintNfts(w.alice, 1);
      const dup = [w.nftAsset(other!), w.nftAsset(other!)];
      await w.expectRevert(w.alice, w.v2, w.abi.v2, "createTrade", [dup, requested, zeroAddress, 0n], "DuplicateAsset", fee);
      await w.expectRevert(w.alice, w.v2, w.abi.v2, "createTrade", [[w.nftAsset(other!)], requested, zeroAddress, 1n], "ExpiryInPast", fee);
      await w.expectRevert(w.alice, w.v2, w.abi.v2, "createTrade", [[w.nftAsset(other!)], [], zeroAddress, 0n], "EmptySide", fee);

      // No receive(): MON sent straight to the contract bounces instead of getting stuck.
      await assert.rejects(w.pub.call({ account: w.bob.account, to: w.v2, value: 1n }), "plain MON transfer to DeClubEscrow should revert");
      await w.send(w.alice, w.v2, w.abi.v2, "cancelTrade", [id]);
    },
  },
  {
    id: "V2-09",
    title: "Fee is per NFT: a bundle pays for every NFT, a side with none pays once, and a 6th NFT is refused",
    async run(w, note) {
      const aliceIds = await w.mintNfts(w.alice, 6);
      await w.approveAll(w.alice, w.v2);
      const fee = await w.v2Fee();
      const requested = [w.monAsset(MON("0.001"))];

      // Five NFTs is the cap, and the maker sends five fees with them.
      const five = aliceIds.slice(0, 5).map((i) => w.nftAsset(i));
      if (fee > 0n) await w.expectRevert(w.alice, w.v2, w.abi.v2, "createTrade", [five, requested, zeroAddress, 0n], "WrongNativeAmount", fee);
      const { id } = await create(w, w.alice, "createTrade", [five, requested, zeroAddress, await expiry(w)], five);
      assert.equal((await w.trade(id)).fee, fee, "the deal records the fee per NFT");

      // The taker's side has no NFT, so it pays one share, not five.
      const filled = await w.send(w.bob, w.v2, w.abi.v2, "fillTrade", [id], owed(requested, fee));
      if (fee > 0n) {
        const [charged] = w.events<{ amount: bigint }>(filled, w.abi.v2, "FeeCharged", w.v2);
        assert.equal(charged?.amount, 6n * fee, "fee should be 5 NFTs + 1 for the MON side");
      }
      note(`5-NFT deal ${id}: fee ${w.fmt(fee)} MON per NFT, ${w.fmt(6n * fee)} in all`);

      // A sixth NFT is refused whatever fee comes with it.
      const six = aliceIds.map((i) => w.nftAsset(i));
      await w.expectRevert(w.alice, w.v2, w.abi.v2, "createTrade", [six, requested, zeroAddress, 0n], "TooManyNfts", 6n * fee);
    },
  },
];
