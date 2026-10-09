import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Address, type Hex, createPublicClient, createWalletClient, getAddress, http, parseEther, toHex } from "viem";
import { foundry } from "viem/chains";
import { mnemonicToAccount } from "viem/accounts";
import { MOCK_CHOG } from "./artifacts.ts";
import { CONTRACTS, REPO } from "./env.ts";
import type { WorldConfig } from "./world.ts";

/** Anvil's default, publicly known test mnemonic. Never holds real funds. */
export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const account = (i: number) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: i });
const keyOf = (i: number): Hex => toHex(account(i).getHdKey().privateKey!);

/** The fee the local deployment starts with, per side, and its ceiling (ADR 0018: about 4×). */
export const LOCAL_FEE = parseEther("2");
export const LOCAL_MAX_FEE = parseEther("8");

export function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });
}

async function waitFor(what: string, probe: () => Promise<unknown>, tries = 150) {
  for (let i = 0; ; i++) {
    try {
      return await probe();
    } catch (e) {
      if (i >= tries) throw new Error(`${what} did not come up: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Run a deploy script with `forge script --broadcast` and read the addresses it prints. */
function forgeScript(script: string, rpcUrl: string, env: Record<string, string>): Record<string, Address> {
  const r = spawnSync("forge", ["script", `script/${script}`, "--rpc-url", rpcUrl, "--broadcast", "--private-key", keyOf(0)], {
    cwd: CONTRACTS,
    encoding: "utf8",
    // Only what the script needs: a developer's shell or .env can't change the deployment.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", ...env },
  });
  if (r.status !== 0) throw new Error(`forge script ${script} failed:\n${r.stdout}\n${r.stderr}`);
  const out: Record<string, Address> = {};
  for (const m of r.stdout.matchAll(/([A-Z0-9_]+)=(0x[0-9a-fA-F]{40})\b/g)) out[m[1]!] = getAddress(m[2]!);
  return out;
}

/**
 * A fresh anvil with the contracts deployed by the real deploy scripts, with a fee, a fee admin
 * and the mocks: what a testnet redeploy does, on a chain we can warp.
 */
export async function startLocal(opts: { matcher: boolean }): Promise<WorldConfig & { deployed: Record<string, Address> }> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  // Monad's block gas limit is far above anvil's default; give the 4-ring room.
  const anvil = spawn("anvil", ["--port", String(port), "--silent", "--gas-limit", "150000000"], { stdio: "ignore" });
  const children: ChildProcess[] = [anvil];
  const tmp = mkdtempSync(join(tmpdir(), "declub-e2e-"));
  const stop = () => {
    for (const c of children) c.kill();
    rmSync(tmp, { recursive: true, force: true });
  };
  process.once("exit", stop);

  try {
    const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
    await waitFor("anvil", () => pub.getChainId());

    const feeRecipient = account(8).address;
    const feeAdmin = account(7);
    const feeEnv = {
      PROTOCOL_FEE_WEI: LOCAL_FEE.toString(),
      PROTOCOL_FEE_MAX_WEI: LOCAL_MAX_FEE.toString(),
      FEE_RECIPIENT: feeRecipient,
      FEE_ADMIN: feeAdmin.address,
    };
    const escrowOut = forgeScript("DeployEscrow.s.sol", rpcUrl, { ...feeEnv, DEPLOY_MOCK_ERC20: "true" });
    const intentsOut = forgeScript("DeployIntents.s.sol", rpcUrl, { ...feeEnv, DEPLOY_MOCK_WMON: "true" });
    // The relayer (account 5) runs reward epochs; a short delay and the shortest window, so the
    // scenarios can warp past both.
    const rewardsOut = forgeScript("DeployRewards.s.sol", rpcUrl, {
      REWARDS_OPERATOR: account(5).address,
      REWARDS_CLAIM_DELAY: "3600",
      REWARDS_CLAIM_WINDOW: "86400",
    });

    // A bare MockChog is enough here; DeployChog.s.sol also mints demo wallets, which the scenarios don't need.
    const deployer = createWalletClient({ account: account(0), chain: foundry, transport: http(rpcUrl) });
    const chog = MOCK_CHOG();
    const hash = await deployer.deployContract({ abi: chog.abi, bytecode: chog.bytecode, args: [] });
    const nft = getAddress((await pub.waitForTransactionReceipt({ hash })).contractAddress!);

    const escrow = escrowOut.NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS;
    const usd = escrowOut.NEXT_PUBLIC_MOCK_ERC20_ADDRESS;
    const intents = intentsOut.NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS;
    const rewards = rewardsOut.NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS;
    if (!escrow || !usd || !intents || !rewards) throw new Error("a deploy script didn't print the expected addresses");

    let poolUrl: string | undefined;
    if (opts.matcher) {
      const mport = await freePort();
      const child = spawn("node", [resolve(REPO, "matcher/src/main.ts")], {
        env: {
          PATH: process.env.PATH,
          MATCHER_ENV_FILE: join(tmp, "none.env"),
          NEXT_PUBLIC_CHAIN_ID: "31337",
          MATCHER_RPC_URL: rpcUrl,
          NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS: intents,
          MATCHER_PRIVATE_KEY: keyOf(9),
          MATCHER_PORT: String(mport),
          MATCHER_DB_PATH: join(tmp, "pool.sqlite"),
          MATCHER_POLL_MS: "300",
          MATCHER_PRUNE_MS: "2000",
        },
        stdio: process.env.E2E_MATCHER_LOGS ? "inherit" : "ignore",
      });
      children.push(child);
      poolUrl = `http://127.0.0.1:${mport}`;
      await waitFor("matcher", async () => {
        const r = await fetch(`${poolUrl}/info`);
        if (!r.ok) throw new Error(String(r.status));
      });
    }

    return {
      target: "local",
      chainId: 31337,
      rpcUrl,
      escrow,
      intents,
      nft,
      usd,
      rewards,
      actors: [1, 2, 3, 4, 5].map(account),
      feeAdmin,
      poolUrl,
      canWarp: true,
      stop,
      deployed: { ...escrowOut, ...intentsOut, ...rewardsOut, NFT: nft, FEE_RECIPIENT: feeRecipient, FEE_ADMIN: feeAdmin.address },
    };
  } catch (e) {
    stop();
    throw e;
  }
}
