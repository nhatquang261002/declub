import assert from "node:assert/strict";
import { type Abi, type Address, type Hex, encodeFunctionData, hashStruct, hashTypedData, parseEther } from "viem";
import { WALLET_1271 } from "../lib/artifacts.ts";
import { domainSeparator } from "../lib/eip712.ts";
import type { Case } from "../lib/report.ts";
import { INTENT_TYPES, type Asset, type Intent, type World } from "../lib/world.ts";

const USD = (n: number) => parseEther(String(n));
/** The matcher refuses cycles above this (matcher/README.md). */
const MATCHER_GAS_CAP = 5_000_000n;

type Signed = { intent: Intent; signature: Hex };

/** Every maker holds the fee and has approved its give; returns the signed cycle. */
async function prepare(w: World, legs: { who: World["alice"]; give: Asset[]; want: Asset[] }[]): Promise<Signed[]> {
  const fee = await w.intentsFee();
  const out: Signed[] = [];
  for (const { who, give, want } of legs) {
    await w.ensureFeeToken(who, fee * 2n);
    for (const a of give) {
      if (a.assetType === 2) await w.approveAll(who, w.intents, a.token);
      else await w.approveToken(who, a.token, w.intents);
    }
    const intent = await w.intent(who.address, give, want);
    out.push({ intent, signature: await w.sign(who, intent) });
  }
  return out;
}

const settleArgs = (cycle: Signed[]) => [cycle.map((c) => c.intent), cycle.map((c) => c.signature)];

async function settle(w: World, cycle: Signed[]) {
  return w.send(w.relayer, w.intents, w.abi.intents, "settle", settleArgs(cycle));
}

function checkFee(w: World, receipt: Awaited<ReturnType<World["send"]>>, fee: bigint, makers: number) {
  if (fee === 0n) return;
  const [ev] = w.events<{ recipient: Address; token: Address; amount: bigint }>(receipt, w.abi.intents, "FeeCharged", w.intents);
  assert.ok(ev, "no FeeCharged event");
  assert.equal(ev.recipient, w.intentsRecipient);
  assert.equal(ev.token, w.feeToken);
  assert.equal(ev.amount, fee * BigInt(makers), `fee should be ${makers} × fee()`);
}

const wire = (i: Intent) => ({
  maker: i.maker,
  give: i.give.map((a) => ({ assetType: a.assetType, token: a.token, id: a.id.toString(), amount: a.amount.toString() })),
  want: i.want.map((a) => ({ assetType: a.assetType, token: a.token, id: a.id.toString(), amount: a.amount.toString() })),
  feeToken: i.feeToken,
  maxFee: i.maxFee.toString(),
  deadline: i.deadline.toString(),
  nonce: i.nonce.toString(),
});

async function pool(w: World, path: string, init?: RequestInit) {
  const r = await fetch(`${w.poolUrl}${path}`, {
    signal: AbortSignal.timeout(15_000),
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, body };
}

export const intentCases: Case<World>[] = [
  {
    id: "IN-01",
    title: "EIP-712 domain, struct hash and digest agree with the contract",
    async run(w) {
      const onChain = await w.read<Hex>(w.intents, w.abi.intents, "DOMAIN_SEPARATOR");
      assert.equal(
        onChain,
        domainSeparator({ ...w.domain, chainId: BigInt(w.chainId) }),
        `domain separator isn't ("${w.domain.name}", "${w.domain.version}"): the app and matcher would sign for another contract`,
      );
      const i = await w.intent(w.alice.address, [w.nftAsset(1n)], [w.tokenAsset(w.usd, 1n)]);
      assert.equal(await w.read<Hex>(w.intents, w.abi.intents, "hashIntent", [i]), hashStruct({ data: i, types: INTENT_TYPES, primaryType: "Intent" }));
      assert.equal(
        await w.read<Hex>(w.intents, w.abi.intents, "intentDigest", [i]),
        hashTypedData({ domain: w.domain, types: INTENT_TYPES, primaryType: "Intent", message: i }),
      );
    },
  },
  {
    id: "IN-02",
    title: "Pair: NFT for ERC-20, settled by a third party; each maker pays the fee in WMON",
    async run(w, note) {
      const [nftId] = await w.mintNfts(w.alice, 1);
      await w.mintUsd(w.bob, USD(20));
      const fee = await w.intentsFee();
      const cycle = await prepare(w, [
        { who: w.alice, give: [w.nftAsset(nftId!)], want: [w.tokenAsset(w.usd, USD(20))] },
        { who: w.bob, give: [w.tokenAsset(w.usd, USD(20))], want: [w.nftAsset(nftId!)] },
      ]);
      const aliceUsd = await w.balanceOf(w.usd, w.alice.address);
      const aliceWmon = await w.balanceOf(w.feeToken, w.alice.address);
      const receipt = await settle(w, cycle);
      note(`settle gas ${receipt.gasUsed}, fee ${w.fmt(fee)} WMON per maker, tx ${receipt.transactionHash}`);
      assert.equal(await w.ownerOf(nftId!), w.bob.address);
      assert.equal((await w.balanceOf(w.usd, w.alice.address)) - aliceUsd, USD(20));
      assert.equal(aliceWmon - (await w.balanceOf(w.feeToken, w.alice.address)), fee, "maker paid a different fee");
      assert.equal(w.events(receipt, w.abi.intents, "IntentFilled", w.intents).length, 2);
      checkFee(w, receipt, fee, 2);
      for (const c of cycle) assert.equal(await w.read<boolean>(w.intents, w.abi.intents, "isNonceUsed", [c.intent.maker, c.intent.nonce]), true);
    },
  },
  {
    id: "IN-03",
    title: "Three-way ring: NFT → ERC-20 → NFT",
    async run(w, note) {
      const [a] = await w.mintNfts(w.alice, 1);
      const [c] = await w.mintNfts(w.carol, 1);
      await w.mintUsd(w.bob, USD(10));
      const fee = await w.intentsFee();
      // cycle[i].give goes to cycle[i + 1].maker.
      const cycle = await prepare(w, [
        { who: w.alice, give: [w.nftAsset(a!)], want: [w.nftAsset(c!)] },
        { who: w.bob, give: [w.tokenAsset(w.usd, USD(10))], want: [w.nftAsset(a!)] },
        { who: w.carol, give: [w.nftAsset(c!)], want: [w.tokenAsset(w.usd, USD(10))] },
      ]);
      const receipt = await settle(w, cycle);
      note(`settle gas ${receipt.gasUsed}`);
      assert.equal(await w.ownerOf(a!), w.bob.address);
      assert.equal(await w.ownerOf(c!), w.alice.address);
      checkFee(w, receipt, fee, 3);
    },
  },
  {
    id: "IN-04",
    title: "Four-way ring (the maximum), under the matcher's 5M gas cap",
    async run(w, note) {
      const [a] = await w.mintNfts(w.alice, 1);
      const [b] = await w.mintNfts(w.bob, 1);
      const [c] = await w.mintNfts(w.carol, 1);
      await w.mintUsd(w.dave, USD(4));
      const fee = await w.intentsFee();
      const cycle = await prepare(w, [
        { who: w.alice, give: [w.nftAsset(a!)], want: [w.tokenAsset(w.usd, USD(4))] },
        { who: w.bob, give: [w.nftAsset(b!)], want: [w.nftAsset(a!)] },
        { who: w.carol, give: [w.nftAsset(c!)], want: [w.nftAsset(b!)] },
        { who: w.dave, give: [w.tokenAsset(w.usd, USD(4))], want: [w.nftAsset(c!)] },
      ]);
      const estimate = await w.pub.estimateContractGas({
        account: w.relayer.account,
        address: w.intents,
        abi: w.abi.intents,
        functionName: "settle",
        args: settleArgs(cycle),
      });
      const receipt = await settle(w, cycle);
      note(`estimate ${estimate}, gas used ${receipt.gasUsed} (matcher cap ${MATCHER_GAS_CAP})`);
      assert.ok((estimate * 11n) / 10n < MATCHER_GAS_CAP, "the matcher would skip this ring as too expensive");
      assert.equal(await w.ownerOf(a!), w.bob.address);
      assert.equal(await w.ownerOf(b!), w.carol.address);
      assert.equal(await w.ownerOf(c!), w.dave.address);
      checkFee(w, receipt, fee, 4);
      // A fifth maker is one too many.
      await w.expectRevert(
        w.relayer,
        w.intents,
        w.abi.intents,
        "settle",
        [[...cycle, cycle[0]!].map((x) => x.intent), [...cycle, cycle[0]!].map((x) => x.signature)],
        "BadCycleSize",
      );
    },
  },
  {
    id: "IN-05",
    title: "Replay and cancel: a settled pair can't settle again; invalidateNonces kills a signed intent",
    async run(w) {
      const [nftId] = await w.mintNfts(w.alice, 1);
      await w.mintUsd(w.bob, USD(4));
      const legs = (id: bigint) => [
        { who: w.alice, give: [w.nftAsset(id)], want: [w.tokenAsset(w.usd, USD(2))] },
        { who: w.bob, give: [w.tokenAsset(w.usd, USD(2))], want: [w.nftAsset(id)] },
      ];
      const cycle = await prepare(w, legs(nftId!));
      await settle(w, cycle);
      await w.expectRevert(w.relayer, w.intents, w.abi.intents, "settle", settleArgs(cycle), "NonceUsed");

      const [next] = await w.mintNfts(w.alice, 1);
      const fresh = await prepare(w, legs(next!));
      const n = fresh[0]!.intent.nonce;
      await w.send(w.alice, w.intents, w.abi.intents, "invalidateNonces", [n >> 8n, 1n << (n & 0xffn)]);
      assert.equal(await w.read<boolean>(w.intents, w.abi.intents, "isNonceUsed", [w.alice.address, n]), true);
      await w.expectRevert(w.relayer, w.intents, w.abi.intents, "settle", settleArgs(fresh), "NonceUsed");
    },
  },
  {
    id: "IN-06",
    title: "Refused: expired, maxFee below the fee, wrong fee token, bad signature, want not met, same maker twice",
    async run(w) {
      const [nftId] = await w.mintNfts(w.alice, 1);
      await w.mintUsd(w.bob, USD(10));
      const fee = await w.intentsFee();
      const base = await prepare(w, [
        { who: w.alice, give: [w.nftAsset(nftId!)], want: [w.tokenAsset(w.usd, USD(10))] },
        { who: w.bob, give: [w.tokenAsset(w.usd, USD(10))], want: [w.nftAsset(nftId!)] },
      ]);
      const [a, b] = base as [Signed, Signed];
      const resign = async (who: World["alice"], i: Intent): Promise<Signed> => ({ intent: i, signature: await w.sign(who, i) });
      const tryCycle = (x: Signed, y: Signed, err: string) => w.expectRevert(w.relayer, w.intents, w.abi.intents, "settle", settleArgs([x, y]), err);

      await tryCycle(await resign(w.alice, { ...a.intent, deadline: (await w.now()) - 1n }), b, "IntentExpired");
      await tryCycle(await resign(w.alice, { ...a.intent, feeToken: w.usd }), b, "WrongFee");
      if (fee > 0n) await tryCycle(await resign(w.alice, { ...a.intent, maxFee: fee - 1n }), b, "WrongFee");
      await tryCycle({ intent: a.intent, signature: await w.sign(w.carol, a.intent) }, b, "BadSignature");
      await tryCycle(a, await resign(w.bob, { ...b.intent, give: [w.tokenAsset(w.usd, USD(9))] }), "WantNotMet");
      await tryCycle(a, await resign(w.alice, { ...b.intent, maker: w.alice.address }), "DuplicateMaker");
      await w.expectRevert(w.relayer, w.intents, w.abi.intents, "settle", [[a.intent], [a.signature]], "BadCycleSize");
      // The originals still settle: none of the above touched state.
      await settle(w, base);
    },
  },
  {
    id: "IN-07",
    title: "ERC-1271 contract wallet as a maker",
    async run(w, note) {
      const art = WALLET_1271();
      const hash = await w.dave.wallet.deployContract({
        abi: art.abi,
        bytecode: art.bytecode,
        args: [w.dave.address],
        account: w.dave.account,
        chain: w.chain,
      });
      const wallet = (await w.confirm(hash, "deploy 1271 wallet")).contractAddress!;
      const exec = (target: Address, abi: Abi, functionName: string, args: unknown[]) =>
        w.send(w.dave, wallet, art.abi, "exec", [target, encodeFunctionData({ abi, functionName, args })]);

      const fee = await w.intentsFee();
      const minted = await w.send(w.dave, w.nft, w.abi.nft, "mint", [wallet, 1n]);
      const nftId = w.events<{ tokenId: bigint }>(minted, w.abi.nft, "Transfer", w.nft)[0]!.tokenId;
      await w.ensureFeeToken(w.dave, fee);
      if (fee > 0n) await w.send(w.dave, w.feeToken, w.abi.erc20, "transfer", [wallet, fee]);
      await exec(w.nft, w.abi.nft, "setApprovalForAll", [w.intents, true]);
      await exec(w.feeToken, w.abi.erc20, "approve", [w.intents, fee]);

      await w.mintUsd(w.bob, USD(3));
      const [bob] = await prepare(w, [{ who: w.bob, give: [w.tokenAsset(w.usd, USD(3))], want: [w.nftAsset(nftId)] }]);
      const mine = await w.intent(wallet, [w.nftAsset(nftId)], [w.tokenAsset(w.usd, USD(3))]);
      const signed: Signed = { intent: mine, signature: await w.sign(w.dave, mine) };

      await w.send(w.dave, wallet, art.abi, "setReject", [true]);
      await w.expectRevert(w.relayer, w.intents, w.abi.intents, "settle", settleArgs([signed, bob!]), "BadSignature");
      await w.send(w.dave, wallet, art.abi, "setReject", [false]);

      const receipt = await settle(w, [signed, bob!]);
      note(`wallet ${wallet}, settle gas ${receipt.gasUsed}`);
      assert.equal(await w.ownerOf(nftId), w.bob.address);
      assert.equal(await w.balanceOf(w.usd, wallet), USD(3));
    },
  },
  {
    id: "IN-08",
    title: "Matcher round trip over HTTP: post a pair, it settles; cancel by signature",
    skip: (w) => (w.poolUrl ? null : "no pool: run with --matcher (local) or set NEXT_PUBLIC_POOL_URL"),
    async run(w, note) {
      const info = await pool(w, "/info");
      assert.equal(info.status, 200, "GET /info failed");
      assert.equal(String(info.body.swap).toLowerCase(), w.intents.toLowerCase(), "the pool settles through another contract");
      assert.equal(Number(info.body.chainId), w.chainId);
      const feeInfo = info.body.fee as { token: string; amount: string };
      assert.equal(feeInfo.token.toLowerCase(), w.feeToken.toLowerCase());
      assert.equal(BigInt(feeInfo.amount), await w.intentsFee());

      const [nftId] = await w.mintNfts(w.alice, 1);
      await w.mintUsd(w.bob, USD(6));
      const cycle = await prepare(w, [
        { who: w.alice, give: [w.nftAsset(nftId!)], want: [w.tokenAsset(w.usd, USD(6))] },
        { who: w.bob, give: [w.tokenAsset(w.usd, USD(6))], want: [w.nftAsset(nftId!)] },
      ]);
      const hashes: string[] = [];
      for (const c of cycle) {
        const r = await pool(w, "/intents", { method: "POST", body: JSON.stringify({ intent: wire(c.intent), signature: c.signature }) });
        assert.ok(r.status === 201 || r.status === 200, `POST /intents ${r.status}: ${JSON.stringify(r.body)}`);
        hashes.push(String(r.body.hash));
      }

      const deadline = Date.now() + Number(process.env.E2E_MATCH_TIMEOUT_MS ?? 90_000);
      for (;;) {
        const states = await Promise.all(hashes.map(async (h) => String((await pool(w, `/intents/${h}`)).body.status)));
        if (states.every((s) => s === "settled")) break;
        if (Date.now() > deadline) assert.fail(`not settled in time: ${states.join(", ")}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.equal(await w.ownerOf(nftId!), w.bob.address);
      const s = await pool(w, `/settlements?maker=${w.alice.address}&limit=5`);
      assert.equal(s.status, 200);
      note(`intents ${hashes.map((h) => h.slice(0, 10)).join(", ")} settled by the matcher`);

      // Cancel: the maker signs CancelIntent(hash); the row turns cancelled and its signature is withheld.
      const [other] = await w.mintNfts(w.carol, 1);
      const [lone] = await prepare(w, [{ who: w.carol, give: [w.nftAsset(other!)], want: [w.tokenAsset(w.usd, USD(999))] }]);
      const posted = await pool(w, "/intents", { method: "POST", body: JSON.stringify({ intent: wire(lone!.intent), signature: lone!.signature }) });
      const h = String(posted.body.hash) as Hex;
      const cancelSig = await w.carol.account.signTypedData({
        domain: w.domain,
        types: { CancelIntent: [{ name: "intentHash", type: "bytes32" }] },
        primaryType: "CancelIntent",
        message: { intentHash: h },
      });
      const wrong = await w.bob.account.signTypedData({
        domain: w.domain,
        types: { CancelIntent: [{ name: "intentHash", type: "bytes32" }] },
        primaryType: "CancelIntent",
        message: { intentHash: h },
      });
      const denied = await pool(w, `/intents/${h}`, { method: "DELETE", body: JSON.stringify({ signature: wrong }) });
      assert.ok(denied.status >= 400, "someone else's signature cancelled the intent");
      const del = await pool(w, `/intents/${h}`, { method: "DELETE", body: JSON.stringify({ signature: cancelSig }) });
      assert.ok(del.status < 300, `DELETE ${del.status}: ${JSON.stringify(del.body)}`);
      const row = (await pool(w, `/intents/${h}`)).body;
      assert.equal(row.status, "cancelled");
      assert.equal(row.signature, "0x", "a cancelled row must not carry the signature");
    },
  },
];
