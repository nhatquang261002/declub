import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { flavorEnv as run } from "../scripts/flavorEnv.mjs";
import { networkFor } from "../lib/network";

function repo(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "flavor-"));
  const web = path.join(root, "web");
  mkdirSync(web);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(root, name), body);
  return { root, web };
}

const MAINNET = [
  "NEXT_PUBLIC_RPC_URL=https://rpc.monad.xyz",
  "NEXT_PUBLIC_CHOG_ADDRESS=0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
  "NEXT_PUBLIC_CHOG_MINTABLE=false",
].join("\n");

const flavorEnv = (flavor: string, o: { root: string; web: string; base: Record<string, string> }) =>
  run(flavor, { ...o, base: o.base as NodeJS.ProcessEnv });

describe("flavorEnv", () => {
  it("leaves testnet alone until a .env.testnet exists", () => {
    const dirs = repo({ ".env": "NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz\n" });
    const { env, problems } = flavorEnv("testnet", { ...dirs, base: {} });
    assert.deepEqual(problems, []);
    assert.equal(env.NEXT_PUBLIC_CHAIN_ID, "10143");
    assert.equal(env.NEXT_DIST_DIR, ".next");
    assert.equal(env.NEXT_PUBLIC_RPC_URL, undefined, "the shared .env is Next's to load, not ours");
    assert.equal(env.MATCHER_ENV_FILE, undefined);
  });

  it("builds mainnet from its own file and blanks every testnet value", () => {
    const dirs = repo({
      ".env": "NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz\nMATCHER_PRIVATE_KEY=0xabc\nNEXT_PUBLIC_CHAIN_ID=10143\n",
      ".env.mainnet": MAINNET,
    });
    const { env, problems } = flavorEnv("mainnet", { ...dirs, base: {} });
    assert.deepEqual(problems, []);
    assert.equal(env.NEXT_PUBLIC_CHAIN_ID, "143");
    assert.equal(env.NEXT_PUBLIC_RPC_URL, "https://rpc.monad.xyz");
    assert.equal(env.MATCHER_PRIVATE_KEY, "", "a testnet key must not reach mainnet");
    assert.equal(env.NEXT_DIST_DIR, ".next-mainnet");
    assert.equal(env.MATCHER_PORT, "8788");
    assert.equal(env.MATCHER_ENV_FILE, path.join(dirs.root, ".env.mainnet"));
  });

  it("lets web/.env.mainnet.local and the real environment win, in that order", () => {
    const dirs = repo({ ".env.mainnet": `${MAINNET}\nPRIVY_APP_SECRET=file\n` });
    writeFileSync(path.join(dirs.web, ".env.mainnet.local"), "PRIVY_APP_SECRET=local\nCRON_SECRET=local\n");
    const { env } = flavorEnv("mainnet", { ...dirs, base: { CRON_SECRET: "host" } });
    assert.equal(env.PRIVY_APP_SECRET, "local", "web/.env.mainnet.local is read after the root file");
    assert.equal(env.CRON_SECRET, "host");
  });

  it("refuses mainnet without its file, with mocks, a publish key, or a testnet database", () => {
    assert.match(flavorEnv("mainnet", { ...repo({}), base: {} }).problems.join("\n"), /\.env\.mainnet is missing/);

    const bad = repo({
      ".env": "UPSTASH_REDIS_REST_URL=https://shared.upstash.io\n",
      ".env.mainnet": `${MAINNET.replace("=false", "=true")}\nNEXT_PUBLIC_MOCK_ERC20_ADDRESS=0x1\nREWARDS_OPERATOR_KEY=0x1\nUPSTASH_REDIS_REST_URL=https://shared.upstash.io/\n`,
    });
    const text = flavorEnv("mainnet", { ...bad, base: {} }).problems.join("\n");
    for (const re of [/MOCK_ERC20/, /REWARDS_OPERATOR_KEY/, /CHOG_MINTABLE/, /Upstash/]) assert.match(text, re);
  });

  it("refuses a chain id from the other flavor", () => {
    const dirs = repo({ ".env.mainnet": `${MAINNET}\nNEXT_PUBLIC_CHAIN_ID=10143\n` });
    assert.match(flavorEnv("mainnet", { ...dirs, base: {} }).problems.join("\n"), /chain 143/);
  });
});

describe("networkFor", () => {
  it("names the chain the build is for", () => {
    assert.equal(networkFor(143).mainnet, true);
    assert.equal(networkFor(143).name, "Monad mainnet");
    assert.equal(networkFor(10143).mainnet, false);
    assert.equal(networkFor(10143).walletName, "Monad Testnet");
  });
});
