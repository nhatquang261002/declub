import assert from "node:assert/strict";
import type { IncomingMessage, Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { type Hex, getAddress } from "viem";
import type { Reader } from "../src/chain.ts";
import { Pool } from "../src/pool.ts";
import { RateLimiter } from "../src/ratelimit.ts";
import { WITHHELD_SIGNATURE, clientIp, createPoolServer } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { AssetType, type Intent } from "../src/types.ts";

const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

describe("RateLimiter", () => {
  it("allows a burst, then refills at the rate", () => {
    const l = new RateLimiter({ perMinute: 6, burst: 2 }); // one every 10 s
    assert.equal(l.take("a", 0), 0);
    assert.equal(l.take("a", 0), 0);
    assert.equal(l.take("a", 0), 10_000, "empty: a token is 10 s away");
    assert.equal(l.take("b", 0), 0, "keys are separate");
    assert.equal(l.take("a", 5_000), 5_000);
    assert.equal(l.take("a", 10_000), 0);
    assert.ok(l.take("a", 10_000) > 0);
  });

  it("does nothing when the rate is 0", () => {
    const l = new RateLimiter({ perMinute: 0 });
    for (let i = 0; i < 1000; i++) assert.equal(l.take("a", 0), 0);
    assert.equal(l.size, 0);
  });

  it("keeps its memory bounded", () => {
    const l = new RateLimiter({ perMinute: 60, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.take(`ip${i}`, i);
    assert.ok(l.size <= 100);
  });
});

describe("clientIp", () => {
  const req = (remote: string, xff?: string) =>
    ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} }) as unknown as IncomingMessage;

  it("uses the socket address unless told to trust a proxy", () => {
    assert.equal(clientIp(req("10.0.0.1", "1.2.3.4")), "10.0.0.1");
  });

  it("behind a trusted proxy, uses the address the proxy appended, not one the client wrote", () => {
    assert.equal(clientIp(req("10.0.0.1", "6.6.6.6, 1.2.3.4"), true), "1.2.3.4");
    assert.equal(clientIp(req("10.0.0.1"), true), "10.0.0.1");
  });
});

/** A pool whose chain is never reached: these requests all stop before any RPC. */
function offlinePool() {
  const store = new Store();
  const pool = new Pool(store, {} as Reader, {
    chainId: 31337,
    swap: addr(0x5),
    feeToken: addr(0xf),
    minTtlSec: 60,
    maxTtlSec: 3600,
  });
  return { store, pool };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const info = {
  chainId: 31337,
  swap: addr(0x5),
  matcher: null,
  fee: async () => ({ token: addr(0xf), amount: "0", recipient: addr(0x8) }),
};

describe("rate limiting over HTTP", () => {
  let server: Server;
  let base: string;
  before(async () => {
    const { pool } = offlinePool();
    server = createPoolServer(pool, info, { ipLimit: new RateLimiter({ perMinute: 60, burst: 3 }) });
    base = await listen(server);
  });
  after(() => server?.close());

  it("refuses POST and DELETE past the per-IP budget with 429 and Retry-After, and leaves GET alone", async () => {
    const post = () => fetch(`${base}/intents`, { method: "POST", body: "{}" });
    for (let i = 0; i < 2; i++) assert.equal((await post()).status, 400); // malformed, but served
    assert.equal((await fetch(`${base}/intents/${hash(1)}`, { method: "DELETE", body: "{}" })).status, 400, "DELETE uses the same budget");
    const limited = await post();
    assert.equal(limited.status, 429);
    assert.equal(((await limited.json()) as { error: string }).error, "rate_limited");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal((await fetch(`${base}/intents`)).status, 200, "reads aren't limited");
  });
});

describe("signatures of intents that left the book", () => {
  let server: Server;
  let base: string;
  let store: Store;
  const SIG = `0x${"ab".repeat(65)}` as Hex;
  const intent = (nonce: bigint): Intent => ({
    maker: addr(0xa1),
    give: [{ assetType: AssetType.ERC721, token: addr(0x1001), id: nonce, amount: 1n }],
    want: [{ assetType: AssetType.ERC20, token: addr(0x2001), id: 0n, amount: 5n }],
    feeToken: addr(0xf),
    maxFee: 0n,
    deadline: 9_999_999_999n,
    nonce,
  });

  before(async () => {
    const p = offlinePool();
    store = p.store;
    for (const n of [1, 2, 3, 4, 5]) store.insert(hash(n), intent(BigInt(n)), SIG, n);
    store.setStatus(hash(2), "cancelled");
    store.setStatus(hash(3), "settled", null, hash(99));
    store.setStatus(hash(4), "expired");
    store.setStatus(hash(5), "stale", "allowance");
    store.recordSettlement({ txHash: hash(99), blockNumber: 1, at: 1, hashes: [hash(3)] });
    server = createPoolServer(p.pool, info);
    base = await listen(server);
  });
  after(() => server?.close());

  const sigOf = async (h: Hex) => ((await (await fetch(`${base}/intents/${h}`)).json()) as { signature: string }).signature;

  it("serves the signature only while the intent is live (open or stale)", async () => {
    assert.equal(await sigOf(hash(1)), SIG);
    assert.equal(await sigOf(hash(5)), SIG);
    for (const h of [hash(2), hash(3), hash(4)]) assert.equal(await sigOf(h), WITHHELD_SIGNATURE);
  });

  it("withholds it in lists and settlements too", async () => {
    const all = (await (await fetch(`${base}/intents?status=all`)).json()) as {
      intents: { hash: Hex; status: string; signature: string }[];
    };
    for (const r of all.intents) {
      assert.equal(r.signature, r.status === "open" || r.status === "stale" ? SIG : WITHHELD_SIGNATURE, r.status);
    }
    const s = (await (await fetch(`${base}/settlements`)).json()) as {
      settlements: { cycle: { signature: string }[] }[];
    };
    assert.equal(s.settlements[0]!.cycle[0]!.signature, WITHHELD_SIGNATURE);
  });
});
