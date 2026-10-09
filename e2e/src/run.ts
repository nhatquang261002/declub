/**
 * End-to-end scenarios against real contracts.
 *
 *   node src/run.ts --target local     fresh anvil, the real deploy scripts, the matcher process
 *   node src/run.ts --target testnet   the addresses in the root .env, funded E2E wallets
 *
 * Options: --only ESC,IN-02 (id prefixes)  --no-matcher (local)
 * Writes e2e/results/e2e-<target>-<time>.{json,md}. Exits 1 if anything failed.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type LocalAccount, parseEther } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { addr, arg, key, loadRootEnv, needAddr, REPO, str } from "./lib/env.ts";
import { startLocal } from "./lib/local.ts";
import { finish, runCases } from "./lib/report.ts";
import { type WorldConfig, makeWorld } from "./lib/world.ts";
import { feeCases } from "./scenarios/fee.ts";
import { intentCases } from "./scenarios/intents.ts";
import { rewardCases } from "./scenarios/rewards.ts";
import { escrowCases } from "./scenarios/escrow.ts";

/** The original testnet MockChog, which anyone can mint from. */
const TESTNET_MOCK_CHOG = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
/** Write scenarios only ever run here: they mint, wrap and trade with test funds. */
const WRITABLE_CHAINS = new Set([10143, 31337]);

function testnetConfig(): WorldConfig {
  loadRootEnv();
  const chainId = Number(str("E2E_CHAIN_ID", str("NEXT_PUBLIC_CHAIN_ID", "10143")));
  if (!WRITABLE_CHAINS.has(chainId)) {
    throw new Error(`chain ${chainId}: scenarios only run on Monad testnet (10143) or anvil. For mainnet use \`npm run verify\` (read-only).`);
  }
  let actors: LocalAccount[];
  const mnemonic = str("E2E_MNEMONIC");
  const keys = str("E2E_PRIVATE_KEYS");
  if (mnemonic) actors = [0, 1, 2, 3, 4].map((i) => mnemonicToAccount(mnemonic, { addressIndex: i }));
  else if (keys) actors = keys.split(",").map((k) => privateKeyToAccount((k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) as `0x${string}`));
  else throw new Error("set E2E_MNEMONIC (accounts 0-4) or E2E_PRIVATE_KEYS (5 keys) to TESTNET-only wallets; account 0 funds the others");
  const adminKey = key("E2E_FEE_ADMIN_KEY");
  return {
    target: "testnet",
    chainId,
    rpcUrl: str("E2E_RPC_URL", str("NEXT_PUBLIC_RPC_URL", "https://testnet-rpc.monad.xyz")),
    escrow: needAddr("NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS"),
    intents: needAddr("NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS"),
    usd: needAddr("E2E_ERC20_ADDRESS", "NEXT_PUBLIC_MOCK_ERC20_ADDRESS"),
    nft: addr("E2E_NFT_ADDRESS") ?? TESTNET_MOCK_CHOG,
    actors,
    feeAdmin: adminKey ? privateKeyToAccount(adminKey) : undefined,
    poolUrl: str("E2E_POOL_URL", str("NEXT_PUBLIC_POOL_URL")) || undefined,
    canWarp: false,
  };
}

async function main() {
  const target = arg("target") ?? "local";
  const only = arg("only");
  let cfg: WorldConfig;
  const meta: Record<string, string> = { target };

  if (target === "local") {
    const matcherReady = existsSync(resolve(REPO, "matcher/node_modules/viem"));
    const wantMatcher = arg("no-matcher") === undefined;
    if (wantMatcher && !matcherReady) console.log("matcher/node_modules missing (npm install in matcher/): IN-08 will skip");
    console.log("starting anvil and deploying with DeployEscrow.s.sol, DeployIntents.s.sol and DeployRewards.s.sol…");
    const local = await startLocal({ matcher: wantMatcher && matcherReady });
    for (const [k, v] of Object.entries(local.deployed)) console.log(`  ${k}=${v}`);
    cfg = local;
  } else if (target === "testnet") {
    cfg = testnetConfig();
  } else {
    throw new Error(`--target must be local or testnet, not ${target}`);
  }

  const w = await makeWorld(cfg);
  try {
    Object.assign(meta, {
      chainId: String(w.chainId),
      escrow: w.escrow,
      intents: w.intents,
      nft: w.nft,
      erc20: w.usd,
      feeToken: w.feeToken,
      pool: w.poolUrl ?? "none",
    });
    for (const [label, a] of [
      ["DeClubEscrow", w.escrow],
      ["DeClubIntents", w.intents],
      ["NFT", w.nft],
      ["ERC-20", w.usd],
    ] as const) {
      const code = await w.pub.getCode({ address: a });
      if (!code || code === "0x") throw new Error(`${label} ${a} has no code on chain ${w.chainId}`);
    }
    if (target === "testnet") {
      const min = parseEther(str("E2E_MIN_MON", "1"));
      console.log(`wallets (account 0 tops the others up to ${w.fmt(min)} MON):`);
      for (const who of [w.alice, w.bob, w.carol, w.dave, w.relayer]) {
        await w.ensureMon(who, min);
        console.log(`  ${who.name.padEnd(8)} ${who.address} ${w.fmt(await w.monOf(who.address))} MON`);
      }
    }
    console.log(`fees: DeClubEscrow ${w.fmt(await w.escrowFee())} MON, DeClubIntents ${w.fmt(await w.intentsFee())} WMON per side\n`);

    // Fee cases go last: FA-04 moves a local chain's clock a week ahead.
    const results = await runCases([...escrowCases, ...intentCases, ...rewardCases, ...feeCases], w, only);
    process.exitCode = finish(`e2e-${target}`, results, meta);
  } finally {
    w.stop();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
