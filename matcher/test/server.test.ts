import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import type { Hex } from "viem";
import { assetKey, cancelTypes, domain } from "../src/intent.ts";
import { createPoolServer } from "../src/server.ts";
import { CHAIN_ID, type World, skipReason, startWorld } from "./harness.ts";

const skip = skipReason() ?? false;
const ONE = 10n ** 18n;

describe("pool HTTP API", { skip }, () => {
  let w: World;
  let server: Server;
  let base: string;
  let ctx: ReturnType<World["fresh"]>;

  before(async () => {
    w = await startWorld();
    ctx = w.fresh();
    server = createPoolServer(ctx.pool, {
      chainId: CHAIN_ID,
      swap: w.swap,
      matcher: w.matcherSender.account.address,
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as { port: number };
    base = `http://127.0.0.1:${port}`;
  });
  after(() => {
    server?.close();
    w?.stop();
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
  };

  async function newPosted() {
    const [id] = await w.mintChogs(w.alice.address, 1);
    await w.approveChog(w.alice, id!);
    const intent = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, ONE)]);
    return { id: id!, intent, body: await w.body(w.alice, intent) };
  }

  it("describes itself", async () => {
    const r = await call("GET", "/info");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, {
      chainId: CHAIN_ID,
      swap: w.swap,
      matcher: w.matcherSender.account.address,
      maxCycle: 4,
    });
  });

  it("answers CORS preflights and allows any origin", async () => {
    const pre = await call("OPTIONS", "/intents");
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");
    assert.match(pre.headers.get("access-control-allow-methods")!, /DELETE/);
  });

  it("posts, lists, filters and fetches an intent", async () => {
    const { id, body } = await newPosted();
    const posted = await call("POST", "/intents", body);
    assert.equal(posted.status, 201);
    const hash = posted.json.hash as Hex;
    assert.equal(posted.json.status, "open");

    assert.equal((await call("POST", "/intents", body)).status, 200, "re-post is idempotent");

    const give = assetKey(w.chogOf(id));
    const byGive = await call("GET", `/intents?give=${give}`);
    assert.deepEqual(byGive.json.intents.map((i: { hash: Hex }) => i.hash), [hash]);
    assert.equal((await call("GET", `/intents?want=${give}`)).json.intents.length, 0);
    assert.equal((await call("GET", `/intents?maker=${w.alice.address}&give=${give}`)).json.intents.length, 1);
    assert.equal((await call("GET", `/intents?maker=${w.bob.address}&give=${give}`)).json.intents.length, 0);
    assert.equal((await call("GET", `/intents?give=${give}&status=settled`)).json.intents.length, 0);

    const one = await call("GET", `/intents/${hash}`);
    assert.equal(one.status, 200);
    assert.equal(one.json.intent.maker, w.alice.address);
    assert.equal(one.json.intent.give[0].id, id.toString(), "bigints travel as strings");
    assert.equal(one.json.signature, body.signature);
  });

  it("reports errors with a status and a code", async () => {
    const { intent } = await newPosted();
    const wrongSigner = { intent: (await w.body(w.alice, intent)).intent, signature: await w.sign(w.bob, intent) };
    const bad = await call("POST", "/intents", wrongSigner);
    assert.deepEqual([bad.status, bad.json.error], [422, "bad_signature"]);

    assert.deepEqual((await call("POST", "/intents", "{nope")).json.error, "bad_request");
    assert.equal((await call("POST", "/intents", { intent: { maker: 1 } })).status, 400);
    assert.equal((await call("GET", "/intents?status=wat")).status, 400);
    assert.equal((await call("GET", "/intents?maker=0x12")).status, 400);
    assert.equal((await call("GET", "/intents?limit=0")).status, 400);
    assert.equal((await call("GET", "/intents/0x12")).status, 400);
    assert.equal((await call("GET", `/intents/0x${"00".repeat(32)}`)).status, 404);
    assert.equal((await call("GET", "/nowhere")).status, 404);
    assert.equal((await call("POST", "/intents", "x".repeat(300 * 1024))).status, 413);
  });

  it("cancels with a maker signature", async () => {
    const { body } = await newPosted();
    const hash = (await call("POST", "/intents", body)).json.hash as Hex;
    const sign = (who: typeof w.alice) =>
      who.account.signTypedData({
        domain: domain(CHAIN_ID, w.swap),
        types: cancelTypes,
        primaryType: "CancelIntent",
        message: { intentHash: hash },
      });

    const forged = await call("DELETE", `/intents/${hash}`, { signature: await sign(w.bob) });
    assert.deepEqual([forged.status, forged.json.error], [403, "bad_signature"]);
    assert.equal((await call("DELETE", `/intents/${hash}`, {})).status, 400);

    const ok = await call("DELETE", `/intents/${hash}`, { signature: await sign(w.alice) });
    assert.deepEqual([ok.status, ok.json.status], [200, "cancelled"]);
    assert.equal((await call("DELETE", `/intents/${hash}`, { signature: await sign(w.alice) })).status, 409);
  });

  it("exposes settled cycles with their intents", async () => {
    const [id] = await w.mintChogs(w.carol.address, 1);
    await w.approveChog(w.carol, id!);
    const sell = w.intent(w.carol.address, [w.chogOf(id!)], [w.tokenOf(w.usd, 9n * ONE)]);
    await w.mintToken(w.usd, w.dave.address, 9n * ONE);
    await w.approveToken(w.dave, w.usd, 9n * ONE);
    const buy = w.intent(w.dave.address, [w.tokenOf(w.usd, 9n * ONE)], [w.chogOf(id!)]);
    assert.equal((await call("POST", "/intents", await w.body(w.carol, sell))).status, 201);
    assert.equal((await call("POST", "/intents", await w.body(w.dave, buy))).status, 201);

    const report = await ctx.matcher.runOnce();
    assert.equal(report.settled.length, 1);

    const all = await call("GET", "/settlements");
    const mine = all.json.settlements.find((s: { txHash: Hex }) => s.txHash === report.settled[0]!.txHash);
    assert.ok(mine, "the settlement is listed");
    assert.equal(mine.cycle.length, 2);
    assert.deepEqual(
      mine.cycle.map((i: { status: string; settlementTx: Hex }) => [i.status, i.settlementTx]),
      [["settled", mine.txHash], ["settled", mine.txHash]],
    );

    const forDave = await call("GET", `/settlements?maker=${w.dave.address}`);
    assert.ok(forDave.json.settlements.some((s: { txHash: Hex }) => s.txHash === mine.txHash));
    const forBob = await call("GET", `/settlements?maker=${w.bob.address}`);
    assert.ok(!forBob.json.settlements.some((s: { txHash: Hex }) => s.txHash === mine.txHash));
    assert.equal((await call("GET", "/settlements?maker=nope")).status, 400);
  });
});
