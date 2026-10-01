import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { CHAIN_ID, type World, skipReason, startWorld } from "./harness.ts";

const skip = skipReason() ?? false;
const MAIN = join(import.meta.dirname, "../src/main.ts");
const ONE = 10n ** 18n;

describe("the matcher process", { skip }, () => {
  let w: World;
  let child: ChildProcess;
  let dir: string;
  let base: string;
  let log = "";

  before(async () => {
    w = await startWorld();
    dir = mkdtempSync(join(tmpdir(), "matcher-test-"));
    const port = await new Promise<number>((ok) => {
      const s = createServer().listen(0, () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => ok(p));
      });
    });
    base = `http://127.0.0.1:${port}`;
    child = spawn("node", [MAIN], {
      env: {
        PATH: process.env.PATH,
        NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID),
        MATCHER_RPC_URL: w.rpcUrl,
        NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS: w.swap,
        MATCHER_PRIVATE_KEY: toHex(
          mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 9 })
            .getHdKey().privateKey!,
        ),
        MATCHER_PORT: String(port),
        MATCHER_DB_PATH: join(dir, "pool.sqlite"),
        MATCHER_POLL_MS: "200",
        MATCHER_PRUNE_MS: "1000",
      },
    });
    child.stdout?.on("data", (d) => (log += d));
    child.stderr?.on("data", (d) => (log += d));
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`${base}/info`)).ok) break;
      } catch {
        // not listening yet
      }
      if (i > 100) throw new Error(`matcher did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  after(() => {
    child?.kill();
    w?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("serves the pool and settles a pair on its own", async () => {
    const info = (await (await fetch(`${base}/info`)).json()) as { swap: string; matcher: string };
    assert.equal(info.swap, w.swap);
    assert.equal(info.matcher, w.matcherSender.account.address);

    const [id] = await w.mintChogs(w.alice.address, 1);
    await w.approveChog(w.alice, id!);
    await w.mintToken(w.usd, w.bob.address, 12n * ONE);
    await w.approveToken(w.bob, w.usd, 12n * ONE);
    const sell = w.intent(w.alice.address, [w.chogOf(id!)], [w.tokenOf(w.usd, 12n * ONE)]);
    const buy = w.intent(w.bob.address, [w.tokenOf(w.usd, 12n * ONE)], [w.chogOf(id!)]);
    for (const [who, intent] of [[w.alice, sell], [w.bob, buy]] as const) {
      const res = await fetch(`${base}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await w.body(who, intent)),
      });
      assert.equal(res.status, 201, await res.text());
    }

    for (let i = 0; i < 100 && (await w.ownerOf(id!)) !== w.bob.address; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(await w.ownerOf(id!), w.bob.address, log);
    // The matcher records the settlement once it has seen the receipt, a moment after the chain moves.
    let settlements: unknown[] = [];
    for (let i = 0; i < 50 && settlements.length === 0; i++) {
      ({ settlements } = (await (await fetch(`${base}/settlements`)).json()) as { settlements: unknown[] });
      if (settlements.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(settlements.length, 1);
    assert.match(log, /settled 2-cycle/);
  });

  it("refuses to start without its configuration", () => {
    const r = spawnSync("node", [MAIN], {
      env: { PATH: process.env.PATH, MATCHER_ENV_FILE: "/nonexistent/.env" },
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS is required/);
  });

  it("rejects a malformed key", () => {
    const r = spawnSync("node", [MAIN], {
      env: {
        PATH: process.env.PATH,
        NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS: w.swap,
        MATCHER_RPC_URL: w.rpcUrl,
        MATCHER_PRIVATE_KEY: "0x1234",
        MATCHER_ENV_FILE: "/nonexistent/.env",
      },
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /MATCHER_PRIVATE_KEY must be/);
  });
});
