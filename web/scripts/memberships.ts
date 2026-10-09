/**
 * Backs up and restores the Clubs' member lists (ADR 0053).
 *
 *   cd web
 *   node --import ./test/register.mjs scripts/memberships.ts --export members.json
 *   node --import ./test/register.mjs scripts/memberships.ts --restore members.json [--club 0x…]
 *
 * A member row exists only in the store. --export writes every Club's signed memberships (the
 * consent each member signed with their Club wallet), and keeps them somewhere other than the
 * store. --restore checks each signature again, finds the account that linked the wallet through
 * Privy, and joins it as a join would; nobody who didn't sign comes back, and running it twice
 * changes nothing. Members who never signed are not in the file and have to join again. Needs the
 * Upstash credentials and PRIVY_APP_SECRET (web/.env.local), like the app.
 */
import path from "node:path";
import { loadEnv, option, requireStore } from "./env";

loadEnv(path.resolve(import.meta.dirname, ".."));

async function main() {
  requireStore();
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { linkedEthereumWallets } = await import("../lib/profiles");
  const { exportJoins, restoreJoins } = await import("../lib/server/joinRecords");
  const { memberCount } = await import("../lib/server/members");
  const { findUserByWallet } = await import("../lib/server/privy");
  const { getStore } = await import("../lib/server/store");
  const { registry } = await import("../lib/verifiedAssets");

  const store = getStore()!;
  const clubs = registry.clubs();
  const only = option("club")?.toLowerCase();

  const exportTo = option("export");
  if (exportTo) {
    const out: Record<string, unknown[]> = {};
    for (const club of clubs) {
      const records = await exportJoins(store, club);
      if (records.length === 0) continue;
      out[club.address.toLowerCase()] = records;
      const members = await memberCount(store, club.address);
      console.log(`${club.symbol}: ${records.length} signed of ${members} members`);
    }
    writeFileSync(exportTo, JSON.stringify(out, null, 2));
    console.log(`wrote ${exportTo}`);
    return;
  }

  const restoreFrom = option("restore");
  if (!restoreFrom) throw new Error("Give --export <file> or --restore <file>.");
  const file: unknown = JSON.parse(readFileSync(restoreFrom, "utf8"));
  if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("The file should be what --export writes.");
  const userOfWallet = async (wallet: string) => {
    const user = await findUserByWallet(wallet);
    return user ? { userId: user.id, wallets: linkedEthereumWallets(user.linked_accounts) } : null;
  };
  for (const [address, records] of Object.entries(file)) {
    const club = registry.clubFor(address);
    if (!club || !Array.isArray(records) || (only && address.toLowerCase() !== only)) continue;
    const { restored, resign, skipped } = await restoreJoins(store, club, records, userOfWallet);
    console.log(`${club.symbol}: restored ${restored} of ${records.length}`);
    for (const w of resign) console.log(`  ${w} is shown under another wallet now; they need to sign again`);
    for (const s of skipped) console.log(`  skipped ${s.wallet}: ${s.reason}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
