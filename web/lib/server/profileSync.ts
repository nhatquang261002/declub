import {
  linkedEthereumWallets,
  pickProfile,
  profileKey,
  userWalletsKey,
  type Profile,
  type StoredProfile,
} from "../profiles";
import type { Store } from "./store";

/** Privy's linked accounts as its server SDK returns them (snake_case). */
type LinkedAccounts = Parameters<typeof pickProfile>[0];

/** The rows this user has written, whichever of their wallets they were for. */
export async function ownedRows(store: Store, userId: string, wallets: string[]) {
  const addresses = new Set([...(await store.members(userWalletsKey(userId))), ...wallets.map((w) => w.toLowerCase())]);
  const list = [...addresses];
  const rows = await store.getMany<StoredProfile>(list.map(profileKey));
  return list.map((address, i) => ({ address, row: rows[i] })).filter((entry) => entry.row?.userId === userId);
}

export type SyncResult =
  | { shared: true; profile: Profile }
  | { shared: false; reason?: "nothing_to_share" };

/**
 * Brings a user's stored profile rows in line with their linked accounts (ADR 0011). Rows for
 * wallets that are no longer linked, or that have nothing left to show, go away; a renamed handle
 * is rewritten. `refresh` keeps an existing share up to date and never starts one, which is what a
 * webhook or a page load wants: only the owner, from `/account`, opts in.
 *
 * Idempotent and based only on `accounts`, so running it twice, or out of order with another
 * sync that read newer accounts, converges on the latest state as long as `accounts` is current.
 */
export async function syncProfile(
  store: Store,
  userId: string,
  accounts: LinkedAccounts,
  refresh: boolean,
): Promise<SyncResult> {
  const wallets = linkedEthereumWallets(accounts);
  const profile = pickProfile(accounts);
  const owned = await ownedRows(store, userId, wallets);

  const keep = profile ? new Set(wallets.map((w) => w.toLowerCase())) : new Set<string>();
  const stale = owned.filter((entry) => !keep.has(entry.address));
  await store.del(...stale.map((entry) => profileKey(entry.address)));

  if (!profile || wallets.length === 0) {
    await store.setMembers(userWalletsKey(userId), []);
    return refresh ? { shared: false } : { shared: false, reason: "nothing_to_share" };
  }
  if (refresh && owned.length === 0) return { shared: false };

  // A share keeps the time it started across rewrites, so a long-linked account's base voice isn't reset (ADR 0039).
  const now = Date.now();
  const since = Math.min(now, ...owned.map((entry) => entry.row!.since ?? entry.row!.updatedAt));
  const row: StoredProfile = { ...profile, userId, updatedAt: now, since };
  await Promise.all(wallets.map((wallet) => store.set(profileKey(wallet), row)));
  await store.setMembers(userWalletsKey(userId), wallets.map((w) => w.toLowerCase()));
  return { shared: true, profile };
}
