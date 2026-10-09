/**
 * Backs up and restores built Club Rewards epochs (ADR 0054).
 *
 *   cd web
 *   node --import ./test/register.mjs scripts/rewards-backup.ts --export epochs.json [--from 0] [--to 7]
 *   node --import ./test/register.mjs scripts/rewards-backup.ts --restore epochs.json [--from-here]
 *
 * An epoch's record, with every Holder's proof, and the inputs it was built from exist only in the
 * store. --export writes them after you build an epoch, and you keep the file somewhere other than
 * the store. --restore puts them back in order from epoch 0, checking each before it writes: the
 * record must hold together (root, proofs, money), match the chain's root and total where the epoch
 * is published, and never replace a different epoch. Running it again finishes one left half done.
 * --from-here lets the first epoch in the file be above 0, for epochs whose earlier ones are
 * claimed and swept; the carry and the streaks then start there.
 *
 * Restore the sponsors first (`rewards:sponsor --restore`): a built epoch's ledger can't be written
 * to, and the check compares each Club's sponsored total with it. The file holds Privy user ids and
 * wallets: keep it private. Needs the same Upstash credentials as the app.
 */
import path from "node:path";
import { flag, loadEnv, option, requireStore } from "./env";

loadEnv(path.resolve(import.meta.dirname, ".."));

async function main() {
  requireStore();
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { createPublicClient, http } = await import("viem");
  const { chain } = await import("../lib/chain");
  const { DECLUB_REWARDS_ADDRESS, RPC_URL } = await import("../lib/config");
  const { deClubRewardsAbi } = await import("../lib/abi");
  const { exportEpoch, restoreEpoch } = await import("../lib/server/epochBackup");
  const { lastKey } = await import("../lib/server/rewards");
  const { getStore } = await import("../lib/server/store");

  const store = getStore()!;

  const exportTo = option("export");
  if (exportTo) {
    const last = await store.get<number>(lastKey());
    const to = option("to") !== undefined ? Number(option("to")) : last;
    if (to === null || !Number.isInteger(to) || to < 0) throw new Error("No epoch has been built yet.");
    const backups = [];
    for (let n = Number(option("from") ?? 0); n <= to; n++) {
      const backup = await exportEpoch(store, n);
      if (backup) backups.push(backup);
      else console.log(`epoch ${n}: not built, left out`);
    }
    writeFileSync(exportTo, JSON.stringify(backups));
    console.log(`wrote ${backups.length} epochs to ${exportTo}`);
    return;
  }

  const restoreFrom = option("restore");
  if (!restoreFrom) throw new Error("Give --export <file> or --restore <file>.");
  if (!DECLUB_REWARDS_ADDRESS) throw new Error("Set NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS.");
  const backups: unknown = JSON.parse(readFileSync(restoreFrom, "utf8"));
  if (!Array.isArray(backups)) throw new Error("The file should be what --export writes.");
  const client = createPublicClient({ chain, transport: http(RPC_URL) });
  const onChain = async (n: number) => {
    const epoch = await client.readContract({ address: DECLUB_REWARDS_ADDRESS, abi: deClubRewardsAbi, functionName: "epochs", args: [BigInt(n)] });
    return { root: epoch.root, total: epoch.total };
  };
  const ordered = [...backups].sort((a, b) => (a?.n ?? 0) - (b?.n ?? 0));
  for (const backup of ordered) {
    const out = await restoreEpoch(store, backup, { onChain, allowGap: flag("from-here") });
    const detail = out.status === "refused" ? `: ${out.reason}` : out.status === "out_of_order" ? `: expected epoch ${out.expected}` : "";
    console.log(`epoch ${backup?.n}: ${out.status}${detail}`);
    // A later epoch would only fail on this one, so stop at the first that can't go back.
    if (out.status === "refused" || out.status === "out_of_order") {
      process.exitCode = 1;
      break;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
