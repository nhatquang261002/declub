/**
 * Records a sponsor's money for a Club's rewards epoch (ADR 0035).
 *
 *   cd web
 *   node --import ./test/register.mjs scripts/rewards-sponsor.ts --list --epoch 3
 *   node --import ./test/register.mjs scripts/rewards-sponsor.ts --epoch 3 --club 0x… --amount 5 --name "Monad Foundation"
 *   node --import ./test/register.mjs scripts/rewards-sponsor.ts --epoch 3 --club 0x… --amount 2 --name "Chog team" --owner
 *   node --import ./test/register.mjs scripts/rewards-sponsor.ts --epoch 3 --remove-tx 0x…   # drop a name that shouldn't show
 *
 *   node --import ./test/register.mjs scripts/rewards-sponsor.ts --export sponsors.json [--from 0] [--to 7]
 *   node --import ./test/register.mjs scripts/rewards-sponsor.ts --restore sponsors.json
 *
 * --export is the backup of the ledger: the one place a payment is tied to a Club and a name. Keep it
 * somewhere other than the store. --restore checks each entry against the chain and the sponsor's
 * signature again (ADR 0053), so it adds nothing the chain doesn't back, and it can run twice.
 *
 * Sponsors can also pay from the app (ADR 0036): the server records those itself, so use --list to
 * see them, and --remove-tx for a name that shouldn't show (the MON stays with the operator).
 *
 * The sponsor sends the MON to the operator's address first; this only writes down who gave what to
 * which Club. When the epoch is built, the amount joins that Club's Holder pool (the top 10 Holders
 * share it, none goes to the protocol), and `rewards-epoch.ts --publish` funds it with the rest. Do
 * it before the epoch is built: a built epoch can't change. Epoch numbers: `epochAt(now)` is the
 * running one.
 *
 * Reads the root .env and web/.env*, like the app, and needs the same Upstash credentials.
 */
import path from "node:path";
import { flag, loadEnv, option, requireStore } from "./env";

loadEnv(path.resolve(import.meta.dirname, ".."));

async function main() {
  requireStore();
  const { formatEther, isAddress, parseEther } = await import("viem");
  const { epochAt } = await import("../lib/rewards");
  const { recordSponsor } = await import("../lib/server/rewards");
  const { readSponsors } = await import("../lib/server/sponsors");
  const { getStore } = await import("../lib/server/store");
  const { registry } = await import("../lib/verifiedAssets");

  const store = getStore()!;
  const now = Math.floor(Date.now() / 1000);
  const n = option("epoch") !== undefined ? Number(option("epoch")) : epochAt(now);
  if (!Number.isInteger(n) || n < 0) throw new Error("Give --epoch <number>; the running epoch isn't known before genesis.");

  if (flag("list")) {
    const entries = await readSponsors(store, n);
    console.log(entries.length === 0 ? `epoch ${n}: no sponsors` : `epoch ${n}:`);
    for (const e of entries)
      console.log(
        `  ${e.club}  ${formatEther(BigInt(e.amount))} MON  ${e.sponsor}${e.kind === "owner" ? " (Owner)" : ""}${e.by ? `  from ${e.by}  ${e.tx ?? ""}` : ""}`,
      );
    return;
  }

  const exportTo = option("export");
  if (exportTo) {
    const { writeFileSync } = await import("node:fs");
    const { exportSponsors } = await import("../lib/server/sponsors");
    const { records, unsigned } = await exportSponsors(store, Number(option("from") ?? 0), Number(option("to") ?? n));
    writeFileSync(exportTo, JSON.stringify(records, null, 2));
    console.log(`wrote ${records.length} sponsorships to ${exportTo}`);
    if (unsigned.length > 0)
      console.log(
        `${unsigned.length} have no signature (recorded by hand or before signatures were kept) and can't be restored from the chain; note them elsewhere.`,
      );
    return;
  }

  const restoreFrom = option("restore");
  if (restoreFrom) {
    const { readFileSync } = await import("node:fs");
    const { restoreSponsors } = await import("../lib/server/sponsorRoutes");
    const records: unknown = JSON.parse(readFileSync(restoreFrom, "utf8"));
    if (!Array.isArray(records)) throw new Error("The file should hold a list of sponsorships, as --export writes it.");
    const { restored, skipped } = await restoreSponsors(store, registry, records);
    console.log(`restored ${restored} of ${records.length}`);
    for (const s of skipped) console.log(`  skipped ${s.tx}: ${s.reason}`);
    return;
  }

  const removeTx = option("remove-tx");
  if (removeTx) {
    const { removeSponsor } = await import("../lib/server/rewards");
    const out = await removeSponsor(store, n, removeTx);
    if (out.status === "built") throw new Error(`Epoch ${n} is already built, so its ledger is fixed.`);
    if (out.status === "missing") throw new Error(`No sponsorship with that transaction in epoch ${n}.`);
    console.log(
      `removed ${formatEther(BigInt(out.entry.amount))} MON from "${out.entry.sponsor}" in epoch ${n}. The MON is still with the operator: record it again under another name, or refund it.`,
    );
    return;
  }

  const club = option("club") ?? "";
  if (!isAddress(club, { strict: false })) throw new Error("Give --club <the Club's NFT collection address>.");
  const entry = registry.clubFor(club);
  if (!entry) throw new Error(`No Club for ${club}.`);
  const amountText = option("amount") ?? "";
  if (!/^\d+(\.\d{1,18})?$/.test(amountText)) throw new Error("Give --amount in MON, for example 5 or 0.25.");
  const result = await recordSponsor(
    store,
    n,
    { club: entry.address, amount: parseEther(amountText), sponsor: option("name") ?? "", kind: flag("owner") ? "owner" : "partner" },
    now,
  );
  if (result.status === "invalid") throw new Error(result.message);
  if (result.status === "busy") throw new Error("Another sponsorship is being recorded for this epoch. Try again in a moment.");
  if (result.status === "built") throw new Error(`Epoch ${n} is already built, so its pools are fixed. Record it for epoch ${n + 1} instead.`);

  const total = result.entries.filter((e) => e.club === entry.address.toLowerCase()).reduce((sum, e) => sum + BigInt(e.amount), 0n);
  console.log(`recorded ${amountText} MON from ${option("name")} to ${entry.symbol} for epoch ${n} (${formatEther(total)} MON sponsored there in all)`);
  console.log("Make sure the MON is in the operator's wallet before you publish the epoch.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
