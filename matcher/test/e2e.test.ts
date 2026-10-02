import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { encodeFunctionData, hashDomain } from "viem";
import { formatAbiItem } from "viem/utils";
import { intentsAbi } from "../src/abi.ts";
import { cancelTypes, domain, intentDigest, intentHash } from "../src/intent.ts";
import { PoolError } from "../src/pool.ts";
import { type World, CHAIN_ID, FEE, skipReason, startWorld, walletAbi } from "./harness.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const skip = skipReason() ?? false;
const ONE = 10n ** 18n;

describe("pool and matcher against a local chain", { skip }, () => {
  let w: World;
  before(async () => {
    w = await startWorld();
  });
  after(() => w?.stop());

  const reject = async (p: Promise<unknown>, code: string) => {
    await assert.rejects(p, (e) => e instanceof PoolError && e.code === code, `expected ${code}`);
  };

  /** Set up `who` to give an NFT, approve it, and post. Returns the intent hash. */
  async function postNft(
    pool: ReturnType<World["fresh"]>["pool"],
    who: World["alice"],
    id: bigint,
    want: ReturnType<World["tokenOf"]>[],
  ) {
    await w.approveChog(who, id);
    const intent = w.intent(who.address, [w.chogOf(id)], want);
    return (await pool.submit(await w.body(who, intent))).hash;
  }

  async function postToken(
    pool: ReturnType<World["fresh"]>["pool"],
    who: World["alice"],
    give: ReturnType<World["tokenOf"]>,
    want: ReturnType<World["chogOf"]>[],
    approve = give.amount,
  ) {
    await w.mintToken(give.token, who.address, give.amount);
    await w.approveToken(who, give.token, approve);
    const intent = w.intent(who.address, [give], want);
    return (await pool.submit(await w.body(who, intent))).hash;
  }

  // ── The contract and the TypeScript side agree ──────────────────────────

  it("hashes and digests intents exactly as the contract does", async () => {
    const [id] = await w.mintChogs(w.alice.address, 1);
    const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, 5n * ONE)]);
    const call = { address: w.swap, abi: intentsAbi, args: [intent] } as const;
    assert.equal(await w.reader.readContract({ ...call, functionName: "hashIntent" }), intentHash(intent));
    assert.equal(
      await w.reader.readContract({ ...call, functionName: "intentDigest" }),
      intentDigest(CHAIN_ID, w.swap, intent),
    );
  });

  it("uses the contract's domain separator", async () => {
    const onChain = await w.reader.readContract({
      address: w.swap, abi: intentsAbi, functionName: "DOMAIN_SEPARATOR",
    });
    const d = domain(CHAIN_ID, w.swap);
    assert.equal(
      onChain,
      hashDomain({
        domain: { ...d, chainId: BigInt(d.chainId) },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
        },
      }),
    );
  });

  it("has an ABI that is a subset of the built contract's", () => {
    const built = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../contracts/out/OnDealIntents.sol/OnDealIntents.json"), "utf8"),
    ) as { abi: Parameters<typeof formatAbiItem>[0][] };
    const sig = (i: Parameters<typeof formatAbiItem>[0]) => `${i.type} ${formatAbiItem(i)}`;
    const have = new Set(built.abi.filter((i) => ["function", "event", "error"].includes(i.type)).map(sig));
    for (const item of intentsAbi) {
      assert.ok(have.has(sig(item as never)), `not in the build: ${sig(item as never)}`);
    }
  });

  // ── Settling ────────────────────────────────────────────────────────────

  it("settles a pair", async () => {
    const { pool, matcher, store } = w.fresh();
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    const a = await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 100n * ONE)]);
    const bobBefore = await w.balanceOf(w.usd, w.bob.address);
    const b = await postToken(pool, w.bob, w.tokenOf(w.usd, 100n * ONE), [w.chogOf(chogId!)]);

    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 1);
    assert.deepEqual(report.settled[0]!.hashes.slice().sort(), [a, b].sort());
    assert.equal(await w.ownerOf(chogId!), w.bob.address);
    assert.equal(await w.balanceOf(w.usd, w.alice.address) >= 100n * ONE, true);
    assert.equal(await w.balanceOf(w.usd, w.bob.address), bobBefore);
    assert.equal(store.get(a)!.status, "settled");
    assert.equal(store.get(b)!.settlementTx, report.settled[0]!.txHash);
    assert.equal(store.settlements().length, 1);
    assert.equal(store.list().length, 0, "nothing left open");
  });

  it("gives the surplus to the receiver and honours the floor", async () => {
    const { pool, matcher } = w.fresh();
    const [chogId] = await w.mintChogs(w.carol.address, 1);
    await postNft(pool, w.carol, chogId!, [w.tokenOf(w.usd, 100n * ONE)]);
    const before = await w.balanceOf(w.usd, w.carol.address);
    await postToken(pool, w.dave, w.tokenOf(w.usd, 130n * ONE), [w.chogOf(chogId!)]);

    await matcher.runOnce();

    assert.equal(await w.balanceOf(w.usd, w.carol.address), before + 130n * ONE);
    assert.equal(await w.ownerOf(chogId!), w.dave.address);
  });

  it("does not match when a want isn't covered", async () => {
    const { pool, matcher } = w.fresh();
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 100n * ONE)]);
    await postToken(pool, w.bob, w.tokenOf(w.usd, 99n * ONE), [w.chogOf(chogId!)]);

    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 0);
    assert.equal(await w.ownerOf(chogId!), w.alice.address);
  });

  it("settles a ring of three that no pair could", async () => {
    const { pool, matcher } = w.fresh();
    // alice: NFT → wants mWETH. bob: mWETH → wants mUSD. carol: mUSD → wants the NFT.
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    await w.approveChog(w.alice, chogId!);
    await pool.submit(await w.body(w.alice, w.intent(w.alice.address, [w.chogOf(chogId!)], [w.tokenOf(w.weth, 3n * ONE)])));
    await w.mintToken(w.weth, w.bob.address, 3n * ONE);
    await w.approveToken(w.bob, w.weth, 3n * ONE);
    await pool.submit(await w.body(w.bob, w.intent(w.bob.address, [w.tokenOf(w.weth, 3n * ONE)], [w.tokenOf(w.usd, 500n * ONE)])));
    await w.mintToken(w.usd, w.carol.address, 500n * ONE);
    await w.approveToken(w.carol, w.usd, 500n * ONE);
    await pool.submit(await w.body(w.carol, w.intent(w.carol.address, [w.tokenOf(w.usd, 500n * ONE)], [w.chogOf(chogId!)])));

    const wethBefore = await w.balanceOf(w.weth, w.alice.address);
    const usdBefore = await w.balanceOf(w.usd, w.bob.address);
    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 1);
    assert.equal(report.settled[0]!.hashes.length, 3);
    assert.equal(await w.ownerOf(chogId!), w.carol.address);
    assert.equal(await w.balanceOf(w.weth, w.alice.address), wethBefore + 3n * ONE);
    assert.equal(await w.balanceOf(w.usd, w.bob.address), usdBefore + 500n * ONE);
    const [s] = pool.store.settlements();
    assert.equal(s!.hashes.length, 3);
  });

  it("settles two unrelated pairs in one pass", async () => {
    const { pool, matcher } = w.fresh();
    const [x] = await w.mintChogs(w.alice.address, 1);
    const [y] = await w.mintChogs(w.carol.address, 1);
    await postNft(pool, w.alice, x!, [w.tokenOf(w.usd, 10n * ONE)]);
    await postToken(pool, w.bob, w.tokenOf(w.usd, 10n * ONE), [w.chogOf(x!)]);
    await postNft(pool, w.carol, y!, [w.tokenOf(w.weth, ONE)]);
    await postToken(pool, w.dave, w.tokenOf(w.weth, ONE), [w.chogOf(y!)]);

    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 2);
    assert.equal(await w.ownerOf(x!), w.bob.address);
    assert.equal(await w.ownerOf(y!), w.dave.address);
  });

  // ── When an intent can't be honoured ────────────────────────────────────

  it("drops a maker who revoked their approval and settles with the next counterparty", async () => {
    const { pool, matcher, store } = w.fresh();
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 100n * ONE)]);
    // bob posts first (older), then pulls his approval; dave is the fallback.
    const bobHash = await postToken(pool, w.bob, w.tokenOf(w.usd, 100n * ONE), [w.chogOf(chogId!)]);
    const daveHash = await postToken(pool, w.dave, w.tokenOf(w.usd, 100n * ONE), [w.chogOf(chogId!)]);
    await w.approveToken(w.bob, w.usd, 0n);
    const sentBefore = await w.reader.getTransactionCount({ address: w.matcherSender.account.address });

    const report = await matcher.runOnce();

    assert.deepEqual(report.dropped.map((d) => [d.hash, d.status]), [[bobHash, "stale"]]);
    assert.equal(report.settled.length, 1);
    assert.ok(report.settled[0]!.hashes.includes(daveHash));
    assert.equal(await w.ownerOf(chogId!), w.dave.address);
    assert.equal(store.get(bobHash)!.status, "stale");
    assert.match(store.get(bobHash)!.reason!, /allowance/);
    assert.equal(store.failureCount(w.bob.address, 0), 1);
    const sentAfter = await w.reader.getTransactionCount({ address: w.matcherSender.account.address });
    assert.equal(sentAfter - sentBefore, 1, "the broken cycle was never sent");
  });

  it("revives a stale intent when the maker fixes it", async () => {
    const { pool, matcher, store } = w.fresh();
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    const bobHash = await postToken(pool, w.bob, w.tokenOf(w.usd, 7n * ONE), [w.chogOf(chogId!)]);
    await w.approveToken(w.bob, w.usd, 0n);

    const first = await pool.prune();
    assert.deepEqual(first.changed.map((c) => c.status), ["stale"]);
    assert.equal(store.list().length, 0, "stale intents are not matched");

    await w.approveToken(w.bob, w.usd, 7n * ONE);
    const second = await pool.prune();
    assert.deepEqual(second.changed.map((c) => c.status), ["open"]);
    assert.equal(store.get(bobHash)!.status, "open");

    await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 7n * ONE)]);
    assert.equal((await matcher.runOnce()).settled.length, 1);
  });

  it("leaves out makers who keep failing", async () => {
    const { pool, matcher, store } = w.fresh({ maxFailures: 1 });
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 5n * ONE)]);
    await postToken(pool, w.bob, w.tokenOf(w.usd, 5n * ONE), [w.chogOf(chogId!)]);
    await w.approveToken(w.bob, w.usd, 0n);
    await matcher.runOnce();
    assert.equal(store.failureCount(w.bob.address, 0), 1);

    await w.approveToken(w.bob, w.usd, 5n * ONE);
    await pool.prune(); // bob's intent is plausible again
    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 0, "bob is banned for now");
    assert.equal(await w.ownerOf(chogId!), w.alice.address);
  });

  it("pins a nonce spent elsewhere on its maker without counting it as a failure", async () => {
    const { pool, matcher, store } = w.fresh();
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    const aliceHash = await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 5n * ONE)]);
    await postToken(pool, w.bob, w.tokenOf(w.usd, 5n * ONE), [w.chogOf(chogId!)]);
    await w.invalidate(w.alice, store.get(aliceHash)!.intent.nonce);

    const report = await matcher.runOnce();

    assert.deepEqual(report.dropped.map((d) => [d.hash, d.status]), [[aliceHash, "consumed"]]);
    assert.equal(report.settled.length, 0);
    assert.equal(store.failureCount(w.alice.address, 0), 0);
  });

  it("prunes an intent whose NFT was moved away", async () => {
    const { pool, store } = w.fresh();
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    const hash = await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 5n * ONE)]);
    const data = encodeFunctionData({
      abi: [{ type: "function", name: "transferFrom", stateMutability: "nonpayable",
        inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "id", type: "uint256" }], outputs: [] }],
      functionName: "transferFrom", args: [w.alice.address, w.bob.address, chogId!],
    });
    await w.tx(w.alice.wallet.sendTransaction({ to: w.chog, data }));

    await pool.prune();

    assert.equal(store.get(hash)!.status, "stale");
    assert.match(store.get(hash)!.reason!, /not_owner/);
  });

  it("won't send a cycle that needs more gas than its cap", async () => {
    const { pool, matcher } = w.fresh({ maxGas: 100_000n });
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 2n * ONE)]);
    await postToken(pool, w.bob, w.tokenOf(w.usd, 2n * ONE), [w.chogOf(chogId!)]);
    const sentBefore = await w.reader.getTransactionCount({ address: w.matcherSender.account.address });

    const report = await matcher.runOnce();

    assert.deepEqual([report.settled.length, report.cooledDown], [0, 1]);
    assert.equal(await w.reader.getTransactionCount({ address: w.matcherSender.account.address }), sentBefore);
    assert.equal(await w.ownerOf(chogId!), w.alice.address);
    // And it isn't retried straight away.
    assert.equal((await matcher.runOnce()).cooledDown, 0);
  });

  // ── Posting ─────────────────────────────────────────────────────────────

  describe("posting", () => {
    it("rejects a signature from someone else", async () => {
      const { pool } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      await w.approveChog(w.alice, id!);
      const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
      await reject(pool.submit({ intent: (await w.body(w.alice, intent)).intent, signature: await w.sign(w.bob, intent) }), "bad_signature");
    });

    it("rejects a malleable (high-s) signature the contract would refuse", async () => {
      const { pool } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      await w.approveChog(w.alice, id!);
      const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
      const { intent: wire, signature } = await w.body(w.alice, intent);
      const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
      const s = BigInt(`0x${signature.slice(66, 130)}`);
      const v = Number(`0x${signature.slice(130)}`);
      const twin = `${signature.slice(0, 66)}${(N - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`;
      await reject(pool.submit({ intent: wire, signature: twin }), "bad_signature");
    });

    it("rejects malformed bodies, bad shapes and bad deadlines", async () => {
      const { pool } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      await w.approveChog(w.alice, id!);
      const now = Math.floor(Date.now() / 1000);
      await reject(pool.submit({ nope: 1 }), "bad_request");
      const same = w.intent(w.alice.address, [w.chogOf(id!)], [w.chogOf(id!)]);
      await reject(pool.submit(await w.body(w.alice, same)), "invalid_intent");
      const soon = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)], { deadline: BigInt(now + 5) });
      await reject(pool.submit(await w.body(w.alice, soon)), "deadline_too_soon");
      const far = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)], { deadline: BigInt(now + 30 * 24 * 3600) });
      await reject(pool.submit(await w.body(w.alice, far)), "deadline_too_far");
    });

    it("rejects an intent the maker can't honour yet", async () => {
      const { pool } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      // not approved
      const noApproval = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
      await reject(pool.submit(await w.body(w.alice, noApproval)), "not_approved");
      // not the owner
      await w.approveChog(w.alice, id!);
      const notOwner = w.intent(w.bob.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
      await reject(pool.submit(await w.body(w.bob, notOwner)), "not_owner");
      // no balance, then no allowance
      const poor = w.intent(w.dave.address, [w.tokenOf(w.usd, 1_000_000n * ONE)], [w.chogOf(id!)]);
      await reject(pool.submit(await w.body(w.dave, poor)), "balance");
      await w.mintToken(w.usd, w.dave.address, 5n * ONE);
      const unapproved = w.intent(w.dave.address, [w.tokenOf(w.usd, 5n * ONE)], [w.chogOf(id!)]);
      await reject(pool.submit(await w.body(w.dave, unapproved)), "allowance");
      // not a token at all
      const junk = w.intent(w.dave.address, [w.tokenOf(w.dave.address, 1n)], [w.chogOf(id!)]);
      await reject(pool.submit(await w.body(w.dave, junk)), "bad_token");
    });

    it("rejects an intent whose nonce is already spent", async () => {
      const { pool } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      await w.approveChog(w.alice, id!);
      const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
      await w.invalidate(w.alice, intent.nonce);
      await reject(pool.submit(await w.body(w.alice, intent)), "nonce_used");
    });

    it("treats a re-post as a no-op", async () => {
      const { pool, store } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      await w.approveChog(w.alice, id!);
      const body = await w.body(w.alice, w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]));
      const first = await pool.submit(body);
      const again = await pool.submit(body);
      assert.deepEqual([first.created, again.created, again.hash], [true, false, first.hash]);
      assert.equal(store.list().length, 1);
    });

    it("cancels with the maker's signature only", async () => {
      const { pool, store } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      const hash = await postNft(pool, w.alice, id!, [w.tokenOf(w.usd, ONE)]);
      const sign = (who: typeof w.alice) =>
        who.account.signTypedData({
          domain: domain(CHAIN_ID, w.swap),
          types: cancelTypes,
          primaryType: "CancelIntent",
          message: { intentHash: hash },
        });
      await assert.rejects(pool.cancel(hash, await sign(w.bob)), (e) => e instanceof PoolError && e.status === 403);
      assert.equal(store.get(hash)!.status, "open");
      assert.equal((await pool.cancel(hash, await sign(w.alice))).status, "cancelled");
      await assert.rejects(pool.cancel(hash, await sign(w.alice)), (e) => e instanceof PoolError && e.status === 409);
    });

    it("cannot reuse an intent signature as a cancel", async () => {
      const { pool } = w.fresh();
      const [id] = await w.mintChogs(w.alice.address, 1);
      const hash = await postNft(pool, w.alice, id!, [w.tokenOf(w.usd, ONE)]);
      const row = pool.store.get(hash)!;
      await assert.rejects(pool.cancel(hash, row.signature), (e) => e instanceof PoolError && e.status === 403);
    });
  });

  // ── Contract wallets ────────────────────────────────────────────────────

  it("accepts and settles an intent from a contract wallet (ERC-1271)", async () => {
    const { pool, matcher } = w.fresh();
    const wallet = await w.deployWallet(w.alice.address);
    const [chogId] = await w.mintChogs(w.bob.address, 1);
    // The wallet holds mUSD and approves via `exec`, signing happens with its owner's key.
    await w.mintToken(w.usd, wallet, 40n * ONE);
    await w.mintToken(w.wmon, wallet, FEE); // and the protocol fee
    for (const [token, amount] of [[w.usd, 40n * ONE], [w.wmon, FEE]] as const) {
      await w.tx(w.alice.wallet.writeContract({
        address: wallet, abi: walletAbi, functionName: "exec",
        args: [token, encodeFunctionData({
          abi: [{ type: "function", name: "approve", stateMutability: "nonpayable",
            inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }],
          functionName: "approve", args: [w.swap, amount],
        })],
      }));
    }
    const walletIntent = w.intent(wallet, [w.tokenOf(w.usd, 40n * ONE)], [w.chogOf(chogId!)]);
    await pool.submit(await w.body(w.alice, walletIntent)); // alice signs for her wallet

    await postNft(pool, w.bob, chogId!, [w.tokenOf(w.usd, 40n * ONE)]);
    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 1);
    assert.equal(await w.ownerOf(chogId!), wallet);
  });

  it("rejects a contract wallet that says no", async () => {
    const { pool } = w.fresh();
    const wallet = await w.deployWallet(w.alice.address);
    const [chogId] = await w.mintChogs(w.bob.address, 1);
    await w.tx(w.alice.wallet.writeContract({ address: wallet, abi: walletAbi, functionName: "setReject", args: [true] }));
    const intent = w.intent(wallet, [w.tokenOf(w.usd, ONE)], [w.chogOf(chogId!)]);
    await assert.rejects(
      pool.submit(await w.body(w.alice, intent)),
      (e) => e instanceof PoolError && e.code === "bad_signature",
    );
  });

  // ── The protocol fee (ADR 0015) ─────────────────────────────────────────

  it("hashes the fee into the intent, as the contract does", async () => {
    const [id] = await w.mintChogs(w.alice.address, 1);
    const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
    assert.equal(intent.maxFee, FEE);
    assert.equal(intent.feeToken, w.wmon);
    const other = { ...intent, maxFee: FEE + 1n };
    assert.notEqual(intentHash(other), intentHash(intent));
    assert.equal(
      await w.reader.readContract({ address: w.swap, abi: intentsAbi, functionName: "hashIntent", args: [other] }),
      intentHash(other),
    );
  });

  it("rejects an intent whose maxFee is below the fee, or that signs another fee token", async () => {
    const { pool } = w.fresh();
    const [id] = await w.mintChogs(w.alice.address, 1);
    await w.approveChog(w.alice, id!);
    for (const patch of [{ maxFee: FEE - 1n }, { maxFee: 0n }, { feeToken: w.usd }]) {
      const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)], patch);
      await reject(pool.submit(await w.body(w.alice, intent)), "wrong_fee");
    }
    // Above the fee is fine: the maker only ever pays the fee.
    const generous = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)], { maxFee: FEE + 1n });
    assert.equal((await pool.submit(await w.body(w.alice, generous))).status, "open");
  });

  it("rejects a maker who can't pay the fee: no approval, too little, or no balance", async () => {
    const { pool } = w.fresh();
    const [id] = await w.mintChogs(w.carol.address, 1);
    await w.approveChog(w.carol, id!);
    const intent = w.intent(w.carol.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
    const body = await w.body(w.carol, intent);

    await w.approveToken(w.carol, w.wmon, FEE - 1n);
    await reject(pool.submit(body), "fee_allowance");
    await w.approveToken(w.carol, w.wmon, 0n);
    await reject(pool.submit(body), "fee_allowance");
    await w.approveToken(w.carol, w.wmon, 2n ** 256n - 1n);

    const held = await w.balanceOf(w.wmon, w.carol.address);
    await w.transferToken(w.carol, w.wmon, w.dave.address, held);
    try {
      await reject(pool.submit(body), "fee_balance");
    } finally {
      await w.transferToken(w.dave, w.wmon, w.carol.address, held);
    }
    assert.equal((await pool.submit(body)).status, "open"); // all good again
  });

  it("counts the fee on top of a give in the same token", async () => {
    const { pool } = w.fresh();
    const [id] = await w.mintChogs(w.alice.address, 1);
    const held = await w.balanceOf(w.wmon, w.bob.address);
    // Giving every WMON leaves nothing for the fee.
    const all = w.intent(w.bob.address, [w.tokenOf(w.wmon, held)], [w.chogOf(id!)]);
    await reject(pool.submit(await w.body(w.bob, all)), "fee_balance");
    const leaving = w.intent(w.bob.address, [w.tokenOf(w.wmon, held - FEE)], [w.chogOf(id!)]);
    assert.equal((await pool.submit(await w.body(w.bob, leaving))).status, "open");
  });

  it("charges every maker in a settled pair, and the contract keeps none of it", async () => {
    const { pool, matcher } = w.fresh();
    const [id] = await w.mintChogs(w.alice.address, 1);
    const [aliceBefore, bobBefore, paidBefore] = await Promise.all([
      w.balanceOf(w.wmon, w.alice.address),
      w.balanceOf(w.wmon, w.bob.address),
      w.balanceOf(w.wmon, w.feeRecipient),
    ]);
    await postNft(pool, w.alice, id!, [w.tokenOf(w.usd, 7n * ONE)]);
    await postToken(pool, w.bob, w.tokenOf(w.usd, 7n * ONE), [w.chogOf(id!)]);

    const report = await matcher.runOnce();

    assert.equal(report.settled.length, 1);
    assert.equal(await w.balanceOf(w.wmon, w.alice.address), aliceBefore - FEE);
    assert.equal(await w.balanceOf(w.wmon, w.bob.address), bobBefore - FEE);
    assert.equal(await w.balanceOf(w.wmon, w.feeRecipient), paidBefore + 2n * FEE);
    assert.equal(await w.balanceOf(w.wmon, w.swap), 0n);
  });

  it("marks an intent stale when its maker revokes the fee approval, and skips it", async () => {
    const { pool, matcher, store } = w.fresh();
    const [id] = await w.mintChogs(w.alice.address, 1);
    const hashA = await postNft(pool, w.alice, id!, [w.tokenOf(w.usd, 3n * ONE)]);
    await postToken(pool, w.bob, w.tokenOf(w.usd, 3n * ONE), [w.chogOf(id!)]);
    const paidBefore = await w.balanceOf(w.wmon, w.feeRecipient);

    await w.approveToken(w.alice, w.wmon, 0n);
    try {
      const report = await matcher.runOnce();
      assert.equal(report.settled.length, 0);
      assert.equal(store.get(hashA)?.status, "stale");
      assert.match(store.get(hashA)?.reason ?? "", /fee_allowance/);
      assert.equal(await w.balanceOf(w.wmon, w.feeRecipient), paidBefore); // nobody was charged
      assert.equal(await w.ownerOf(id!), w.alice.address);
    } finally {
      await w.approveToken(w.alice, w.wmon, 2n ** 256n - 1n);
    }

    // Approval back: the next prune revives it and the pair settles.
    await pool.prune();
    assert.equal(store.get(hashA)?.status, "open");
    assert.equal((await matcher.runOnce()).settled.length, 1);
    assert.equal(await w.ownerOf(id!), w.bob.address);
  });

  // ── Time ────────────────────────────────────────────────────────────────

  it("runs in the background and picks up a new intent promptly", async () => {
    const { pool, matcher } = w.fresh();
    matcher.start({ pollMs: 60_000, pruneMs: 60_000 });
    try {
      const [chogId] = await w.mintChogs(w.alice.address, 1);
      await postNft(pool, w.alice, chogId!, [w.tokenOf(w.usd, 3n * ONE)]);
      await postToken(pool, w.bob, w.tokenOf(w.usd, 3n * ONE), [w.chogOf(chogId!)]); // kicks the matcher
      for (let i = 0; i < 100 && (await w.ownerOf(chogId!)) !== w.bob.address; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(await w.ownerOf(chogId!), w.bob.address);
    } finally {
      matcher.stop();
    }
  });

  it("turns an intent that expired on-chain into 'expired', not a failure", async () => {
    const { pool, matcher, store } = w.fresh({ minRemainingSec: 1 });
    const [chogId] = await w.mintChogs(w.alice.address, 1);
    await w.approveChog(w.alice, chogId!);
    const soon = w.intent(w.alice.address, [w.chogOf(chogId!)], [w.tokenOf(w.usd, ONE)], {
      deadline: BigInt(Math.floor(Date.now() / 1000) + 120),
    });
    const hash = (await pool.submit(await w.body(w.alice, soon))).hash;
    await postToken(pool, w.bob, w.tokenOf(w.usd, ONE), [w.chogOf(chogId!)]);
    await w.increaseTime(300); // the chain moves past the deadline; the wall clock hasn't

    const report = await matcher.runOnce();

    assert.deepEqual(report.dropped.map((d) => [d.hash, d.status]), [[hash, "expired"]]);
    assert.equal(report.settled.length, 0);
    assert.equal(store.failureCount(w.alice.address, 0), 0);
  });
});
