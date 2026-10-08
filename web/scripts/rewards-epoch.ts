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
 * Every signer runs scripts/rewards-verify.ts with the Safe transaction's root and value first, and
 * signs only on PASS.
 *
 * `publish` takes native MON, but signed swaps paid their fees in WMON. When the operator's MON is
 * short of the total, it unwraps the difference from its own WMON first: --publish sends that
 * `withdraw` before `publish`; without it, the script prints both calls as a Safe batch. Fees that
 * sit at a different fee recipient have to be unwrapped and sent to the operator first.
 *
 * Before building, it reads the X reach of the epoch's X shares (ADR 0024) with X_BEARER_TOKEN
 * (web/.env.local; pay per use, about $0.005 a post). Without it, X shares count with no reach.
 *
 * Building is safe to repeat: an epoch is built once, and later runs print the stored one. What a
 * Club can't pay (no Holders, no Owner, rounding) rolls into the next epoch, so publish every epoch
 * you build, in order.
 */
import path from "node:path";
import { flag, loadEnv, option, requireStore } from "./env";

const web = path.resolve(import.meta.dirname, "..");
loadEnv(web);

async function main() {
  requireStore();
  // Imported after the env is loaded: the app's config reads it once, at import.
  const { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { chain } = await import("../lib/chain");
  const { DECLUB_INTENTS_ADDRESS, DECLUB_REWARDS_ADDRESS, RPC_URL } = await import("../lib/config");
  const { deClubIntentsAbi, deClubRewardsAbi } = await import("../lib/abi");
  const { wmonAbi } = await import("../lib/contracts");
  const { PUBLISH_GAS_LIMIT, fundingPlan } = await import("../lib/server/rewardsFunding");
  const { epochAt, epochWindow } = await import("../lib/rewards");
  const { buildEpoch, lastKey, readEpoch } = await import("../lib/server/rewards");
  const { collectReach } = await import("../lib/server/xReach");
  const { getStore } = await import("../lib/server/store");

  if (!DECLUB_REWARDS_ADDRESS) throw new Error("Set NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS.");
  const store = getStore()!;
  const last = await store.get<number>(lastKey());
  const now = Math.floor(Date.now() / 1000);
  const n = option("epoch") !== undefined ? Number(option("epoch")) : last !== null ? last + 1 : epochAt(now) - 1;
  if (!Number.isInteger(n) || n < 0) throw new Error(`No finished epoch to build (got ${n}).`);

  // The reach is read once, before the epoch is built, and kept with it.
  if (!(await readEpoch(store, n)) && now >= epochWindow(n).end) {
    const reach = await collectReach(store, n);
    const posts = Object.values(reach.posts);
    console.log(
      reach.available
        ? `X reach: ${posts.length} X shares read, ${posts.filter((p) => p.ok).length} still count`
        : "X reach: X_BEARER_TOKEN isn't set, so X shares count without reach",
    );
  }

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
      `  ${club.club}  fees ${formatEther(BigInt(club.fees))}${club.signedFees ? ` (signed ${formatEther(BigInt(club.signedFees))} WMON)` : ""}  Holders ${formatEther(BigInt(club.paidHolders))} (${club.holderCount})` +
        `  fund ${formatEther(BigInt(club.paidFund))}  rolls over ${formatEther(BigInt(club.carry.holders) + BigInt(club.carry.fund))}`,
    );
  }

  const bonused = record.leaves.flatMap((l) => l.breakdown).filter((b) => (b.bonusBps ?? 0) > 0);
  if (bonused.length > 0) console.log(`  Holder bonus: ${bonused.length} Holder payouts got a bonus`);
  const streaking = record.leaves.flatMap((l) => l.breakdown).filter((b) => (b.streak ?? 0) >= 2);
  if (streaking.length > 0) console.log(`  Streaks: ${streaking.length} Holder payouts had a streak bonus`);

  if (record.leaves.length === 0) {
    console.log("\nNothing to pay this epoch: there is nothing to publish.");
    return;
  }
  const pub = createPublicClient({ chain, transport: http(RPC_URL) });
  const onChain = await pub.readContract({ address: DECLUB_REWARDS_ADDRESS, abi: deClubRewardsAbi, functionName: "epochs", args: [BigInt(record.n)] });
  if (onChain.root !== `0x${"0".repeat(64)}`) {
    console.log(`\nAlready published on chain with root ${onChain.root}${onChain.root === record.root ? "" : " (a different root!)"}.`);
    return;
  }

  // Funding: `publish` takes MON, and signed swaps paid their fees in WMON. Unwrap what's short.
  const total = BigInt(record.total);
  const operator = await pub.readContract({ address: DECLUB_REWARDS_ADDRESS, abi: deClubRewardsAbi, functionName: "operator" });
  const feeToken = DECLUB_INTENTS_ADDRESS
    ? await pub.readContract({ address: DECLUB_INTENTS_ADDRESS, abi: deClubIntentsAbi, functionName: "FEE_TOKEN" })
    : undefined;
  const wmonOf = (owner: `0x${string}`) =>
    feeToken ? pub.readContract({ address: feeToken, abi: wmonAbi, functionName: "balanceOf", args: [owner] }) : Promise.resolve(0n);
  const [mon, wmon, fees] = await Promise.all([pub.getBalance({ address: operator }), wmonOf(operator), pub.estimateFeesPerGas()]);
  // Gas is billed on the limit on Monad: keep back enough for an unwrap and the publish.
  const plan = fundingPlan({ total, mon, wmon, gas: 2n * PUBLISH_GAS_LIMIT * fees.maxFeePerGas });
  console.log(`\nfunding  operator ${operator} holds ${formatEther(mon)} MON and ${formatEther(wmon)} WMON`);
  if (plan.unwrap > 0n) console.log(`  unwrap ${formatEther(plan.unwrap)} WMON first`);
  if (plan.short > 0n) {
    console.log(`  still short ${formatEther(plan.short)} MON after unwrapping`);
    const recipient = DECLUB_INTENTS_ADDRESS
      ? await pub.readContract({ address: DECLUB_INTENTS_ADDRESS, abi: deClubIntentsAbi, functionName: "FEE_RECIPIENT" })
      : undefined;
    if (recipient && recipient.toLowerCase() !== operator.toLowerCase()) {
      console.log(`  the fee recipient ${recipient} holds ${formatEther(await wmonOf(recipient))} WMON: unwrap it there and send the MON to the operator`);
    }
  }

  if (!flag("publish")) {
    console.log("\nNot published. Run again with --publish, or send this from the operator as one batch:");
    if (plan.unwrap > 0n) {
      console.log(
        `  1. to ${feeToken}  value 0  data ${encodeFunctionData({ abi: wmonAbi, functionName: "withdraw", args: [plan.unwrap] })}  (withdraw ${formatEther(plan.unwrap)} WMON)`,
      );
    }
    console.log(
      `  ${plan.unwrap > 0n ? 2 : 1}. to ${DECLUB_REWARDS_ADDRESS}  value ${total} wei  data ${encodeFunctionData({ abi: deClubRewardsAbi, functionName: "publish", args: [BigInt(record.n), record.root] })}  (publish(${record.n}, root))`,
    );
    return;
  }
  const key = process.env.REWARDS_OPERATOR_KEY?.trim();
  if (!key) throw new Error("--publish needs REWARDS_OPERATOR_KEY.");
  const account = privateKeyToAccount(key as `0x${string}`);
  if (account.address.toLowerCase() !== operator.toLowerCase())
    throw new Error(`REWARDS_OPERATOR_KEY is ${account.address}, not the contract's operator ${operator}.`);
  if (plan.short > 0n) throw new Error(`The operator needs ${formatEther(plan.short)} more MON to publish.`);
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
  if (plan.unwrap > 0n) {
    const unwrapHash = await wallet.writeContract({ address: feeToken!, abi: wmonAbi, functionName: "withdraw", args: [plan.unwrap] });
    const unwrapped = await pub.waitForTransactionReceipt({ hash: unwrapHash });
    if (unwrapped.status !== "success") throw new Error(`The unwrap reverted: ${unwrapHash}`);
    console.log(`unwrapped ${formatEther(plan.unwrap)} WMON in ${unwrapHash}`);
    // A wallet near Monad's reserve can't send a second transaction right after the first.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const hash = await wallet.writeContract({
    address: DECLUB_REWARDS_ADDRESS,
    abi: deClubRewardsAbi,
    functionName: "publish",
    args: [BigInt(record.n), record.root],
    value: total,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`\npublished in ${hash} (block ${receipt.blockNumber}, ${receipt.status})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
