/**
 * Checks a built Club Rewards epoch before anyone signs `publish(epoch, root)` for it (ADR 0022).
 * Every Safe signer runs it on their own machine and signs only on PASS.
 *
 *   cd web
 *   node --import ./test/register.mjs scripts/rewards-verify.ts                    # the last built epoch
 *   node --import ./test/register.mjs scripts/rewards-verify.ts --epoch 3          # epoch 3
 *   node --import ./test/register.mjs scripts/rewards-verify.ts --epoch 3 --root 0x… --value 12.5MON
 *
 * --root and --value are what the Safe transaction shows: the `root` argument and the MON sent with
 * it. --value takes wei (digits only, e.g. 12500000000000000000) or MON with the unit attached
 * (e.g. 12.5MON). Both must match the stored epoch exactly.
 *
 * It reads the stored epoch, the earlier ones (for what rolled into each Club) and the sponsors
 * ledger, with the Upstash credentials the app uses, and the chain at NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS:
 * the contract's own `leaf()` for every leaf, `epochs(n)`, `operator()`, and each sponsor's
 * payment. It writes nothing. Exits 1 on any problem. What it can't catch is in docs/04-security.md.
 */
import path from "node:path";
import type { EpochRecord } from "../lib/rewards";
import { loadEnv } from "./env";

const web = path.resolve(import.meta.dirname, "..");
loadEnv(web);

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Leaves read per multicall. */
const LEAF_BATCH = 200;

async function main() {
  if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) {
    throw new Error("No store: set the Upstash credentials the app uses (UPSTASH_REDIS_REST_URL / _TOKEN).");
  }
  // Imported after the env is loaded: the app's config reads it once, at import.
  const { createPublicClient, formatEther, getAddress, http, parseEther } = await import("viem");
  const { chain } = await import("../lib/chain");
  const { CHAIN_ID, DECLUB_REWARDS_ADDRESS, RPC_URL } = await import("../lib/config");
  const { deClubRewardsAbi } = await import("../lib/abi");
  const { lastKey, readEpoch } = await import("../lib/server/rewards");
  const { carriedInFrom, verifyEpochRecord } = await import("../lib/server/rewardsVerify");
  const { readSponsors, sponsorsByClub } = await import("../lib/server/sponsors");
  const { getStore } = await import("../lib/server/store");

  if (!DECLUB_REWARDS_ADDRESS) throw new Error("Set NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS.");
  const contract = DECLUB_REWARDS_ADDRESS;
  const store = getStore()!;

  const raw = option("epoch");
  const last = await store.get<number>(lastKey());
  const n = raw !== undefined ? Number(raw) : last;
  if (n === null || !Number.isInteger(n) || n < 0) throw new Error(raw !== undefined ? `Bad --epoch: ${raw}` : "No epoch has been built yet.");

  const rootArg = option("root");
  if (rootArg !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(rootArg)) throw new Error(`Bad --root: ${rootArg}`);
  const valueArg = option("value");
  let value: bigint | undefined;
  if (valueArg !== undefined) {
    const mon = /^([0-9]+(?:\.[0-9]+)?)\s*MON$/i.exec(valueArg.trim());
    if (mon) value = parseEther(mon[1]!);
    else if (/^[0-9]+$/.test(valueArg.trim())) value = BigInt(valueArg.trim());
    else throw new Error(`Bad --value: ${valueArg} (give wei, like 12500000000000000000, or MON, like 12.5MON)`);
  }

  const record = await readEpoch(store, n);
  if (!record) throw new Error(`Epoch ${n} hasn't been built.`);

  // Every earlier epoch, for what rolled into each Club and the previous total.
  const earlier: EpochRecord[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const r = await readEpoch(store, k);
    if (r) earlier.push(r);
  }
  const sponsorEntries = await readSponsors(store, n);
  const sponsored = new Map([...sponsorsByClub(sponsorEntries)].map(([club, s]) => [club, s.total]));

  const client = createPublicClient({ chain, transport: http(RPC_URL) });
  const problems: string[] = [];

  // The contract's own leaf hash for every leaf: the TS leaf encoding isn't trusted.
  const leafHashes: `0x${string}`[] = [];
  for (let i = 0; i < record.leaves.length; i += LEAF_BATCH) {
    const batch = record.leaves.slice(i, i + LEAF_BATCH);
    const hashes = await client.multicall({
      allowFailure: false,
      contracts: batch.map((l) => ({
        address: contract,
        abi: deClubRewardsAbi,
        functionName: "leaf",
        args: [BigInt(n), getAddress(l.account), BigInt(l.amount)],
      }) as const),
    });
    leafHashes.push(...hashes);
  }

  const result = verifyEpochRecord({
    record,
    expected: { n, chainId: CHAIN_ID, contract },
    carriedIn: carriedInFrom(earlier, n),
    sponsored,
    leafHashes,
    previousTotal: earlier[0] ? BigInt(earlier[0].total) : null,
  });
  problems.push(...result.problems);

  // What the signer was handed.
  if (rootArg !== undefined && rootArg.toLowerCase() !== record.root.toLowerCase()) {
    problems.push(`The Safe transaction's root ${rootArg} isn't the epoch's ${record.root}.`);
  }
  if (value !== undefined && value !== BigInt(record.total)) {
    problems.push(`The Safe transaction sends ${value} wei (${formatEther(value)} MON), but the epoch pays ${record.total} wei (${formatEther(BigInt(record.total))} MON).`);
  }

  // The chain.
  const [onChain, operator] = await Promise.all([
    client.readContract({ address: contract, abi: deClubRewardsAbi, functionName: "epochs", args: [BigInt(n)] }),
    client.readContract({ address: contract, abi: deClubRewardsAbi, functionName: "operator" }),
  ]);
  const published = onChain.root !== `0x${"0".repeat(64)}`;
  if (published) {
    if (onChain.root.toLowerCase() !== record.root.toLowerCase()) problems.push(`Epoch ${n} is published on chain with a different root: ${onChain.root}.`);
    if (onChain.total !== BigInt(record.total)) problems.push(`Epoch ${n} is funded on chain with ${onChain.total} wei, not the record's ${record.total}.`);
  }

  // Sponsors' money: each payment the app checked must really have reached the operator.
  const txs = new Set<string>();
  let unchecked = 0;
  for (const entry of sponsorEntries) {
    if (!entry.tx) {
      unchecked++;
      continue;
    }
    const at = `Sponsorship "${entry.sponsor}" (${entry.tx})`;
    if (txs.has(entry.tx.toLowerCase())) problems.push(`${at} is in the ledger more than once.`);
    txs.add(entry.tx.toLowerCase());
    try {
      const hash = entry.tx as `0x${string}`;
      const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
      if (receipt.status !== "success") problems.push(`${at}: the transaction failed.`);
      if (!tx.to || tx.to.toLowerCase() !== operator.toLowerCase()) problems.push(`${at}: paid ${tx.to ?? "no one"}, not the operator ${operator}.`);
      if (tx.value < BigInt(entry.amount)) problems.push(`${at}: sent ${tx.value} wei but is recorded as ${entry.amount}.`);
      if (entry.by && tx.from.toLowerCase() !== entry.by.toLowerCase()) problems.push(`${at}: sent by ${tx.from}, recorded as ${entry.by}.`);
    } catch {
      problems.push(`${at}: the transaction can't be read from the chain.`);
    }
  }

  const total = BigInt(record.total);
  console.log(`epoch    ${n}`);
  console.log(`contract ${contract} (chain ${CHAIN_ID})`);
  console.log(`operator ${operator}`);
  console.log(`root     ${record.root}`);
  console.log(`value    ${total} wei = ${formatEther(total)} MON`);
  console.log(`on chain ${published ? `published, opens ${new Date(Number(onChain.openAt) * 1000).toISOString()}` : "not published yet"}`);
  for (const note of result.notes) console.log(`note     ${note}`);
  if (sponsorEntries.length > 0) {
    console.log(`note     ${sponsorEntries.length - unchecked} sponsor payments checked on chain${unchecked ? `; ${unchecked} without a transaction, check those by hand` : ""}.`);
  }
  if (rootArg === undefined || value === undefined) console.log("note     Pass --root and --value from the Safe transaction to check them too.");

  if (problems.length > 0) {
    console.log(`\nFAIL: ${problems.length} problem${problems.length === 1 ? "" : "s"}. Don't sign.`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nPASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
