/**
 * Builds a Club Rewards epoch and, with --publish, funds it on DeClubRewards (ADR 0022).
 *
 *   cd web
 *   node --import ./test/register.mjs scripts/rewards-epoch.ts               # build the next finished epoch
 *   node --import ./test/register.mjs scripts/rewards-epoch.ts --epoch 3     # build epoch 3 (must be next)
 *   node --import ./test/register.mjs scripts/rewards-epoch.ts --publish     # build, then publish and fund it
 *
 * Reads the root .env and web/.env*, like the app. Needs the Upstash credentials the app uses (the
 * Club memberships and activity live there), NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS, and for --publish
 * REWARDS_OPERATOR_KEY: the private key of the contract's operator. On mainnet the operator is a
 * Safe; there, build without --publish and send `publish(epoch, root)` with `total` from the Safe.
 *
 * Building is safe to repeat: an epoch is built once, and later runs print the stored one. What a
 * Club can't pay (no Holders, no Owner, rounding) rolls into the next epoch, so publish every epoch
 * you build, in order.
 */
import path from "node:path";
import nextEnv from "@next/env";

// A CommonJS package: Node only gives ESM a default export for it.
const { loadEnvConfig } = nextEnv;

const web = path.resolve(import.meta.dirname, "..");
loadEnvConfig(path.resolve(web, ".."), false, { info: () => {}, error: console.error }, true);
loadEnvConfig(web, false, { info: () => {}, error: console.error }, true);

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) {
    throw new Error("No store: set the Upstash credentials the app uses (UPSTASH_REDIS_REST_URL / _TOKEN).");
  }
  // Imported after the env is loaded: the app's config reads it once, at import.
  const { createPublicClient, createWalletClient, formatEther, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { chain } = await import("../lib/chain");
  const { DECLUB_REWARDS_ADDRESS, RPC_URL } = await import("../lib/config");
  const { deClubRewardsAbi } = await import("../lib/abi");
  const { epochAt } = await import("../lib/rewards");
  const { buildEpoch, lastKey } = await import("../lib/server/rewards");
  const { getStore } = await import("../lib/server/store");

  if (!DECLUB_REWARDS_ADDRESS) throw new Error("Set NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS.");
  const store = getStore()!;
  const last = await store.get<number>(lastKey());
  const now = Math.floor(Date.now() / 1000);
  const n = option("epoch") !== undefined ? Number(option("epoch")) : last !== null ? last + 1 : epochAt(now) - 1;
  if (!Number.isInteger(n) || n < 0) throw new Error(`No finished epoch to build (got ${n}).`);

  const result = await buildEpoch(store, n);
  if (result.status === "open") throw new Error(`Epoch ${n} is still running; it ends at ${new Date(result.endsAt * 1000).toISOString()}.`);
  if (result.status === "out_of_order") throw new Error(`Epochs are built in order: build ${result.expected} first.`);
  if (result.status === "busy") throw new Error("Another build is running.");
  if (result.status === "unconfigured") throw new Error("Set NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS.");
  const { record } = result;

  console.log(`epoch ${record.n} ${result.status === "built" ? "built" : "already built"}`);
  console.log(`  window  ${new Date(record.start * 1000).toISOString()} → ${new Date(record.end * 1000).toISOString()}`);
  console.log(`  root    ${record.root}`);
  console.log(`  total   ${formatEther(BigInt(record.total))} MON over ${record.leaves.length} accounts`);
  for (const club of record.clubs.filter((c) => c.fees !== "0" || c.carry.holders !== "0" || c.carry.fund !== "0")) {
    console.log(
      `  ${club.club}  fees ${formatEther(BigInt(club.fees))}  Holders ${formatEther(BigInt(club.paidHolders))} (${club.holderCount})` +
        `  fund ${formatEther(BigInt(club.paidFund))}  rolls over ${formatEther(BigInt(club.carry.holders) + BigInt(club.carry.fund))}`,
    );
  }

  if (!flag("publish")) {
    console.log("\nNot published. Run again with --publish, or send publish(epoch, root) with `total` as value from the operator.");
    return;
  }
  if (record.leaves.length === 0) {
    console.log("\nNothing to pay this epoch: there is nothing to publish.");
    return;
  }
  const key = process.env.REWARDS_OPERATOR_KEY?.trim();
  if (!key) throw new Error("--publish needs REWARDS_OPERATOR_KEY.");
  const account = privateKeyToAccount(key as `0x${string}`);
  const pub = createPublicClient({ chain, transport: http(RPC_URL) });
  const onChain = await pub.readContract({ address: DECLUB_REWARDS_ADDRESS, abi: deClubRewardsAbi, functionName: "epochs", args: [BigInt(record.n)] });
  if (onChain.root !== `0x${"0".repeat(64)}`) {
    console.log(`\nAlready published on chain with root ${onChain.root}${onChain.root === record.root ? "" : " (a different root!)"}.`);
    return;
  }
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
  const hash = await wallet.writeContract({
    address: DECLUB_REWARDS_ADDRESS,
    abi: deClubRewardsAbi,
    functionName: "publish",
    args: [BigInt(record.n), record.root],
    value: BigInt(record.total),
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`\npublished in ${hash} (block ${receipt.blockNumber}, ${receipt.status})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
