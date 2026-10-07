import type { Address } from "viem";
import { aboutKey, aboutWalletsKey, hasAbout, type About, type StoredAbout } from "../about";
import type { Store } from "./store";

/**
 * Display names and bios on the server (ADR 0042). The user's wallets always come from Privy, never
 * from the request. The same row is kept for each linked wallet, so a visitor can open a profile
 * from whichever of them they saw, the way avatars work (ADR 0028).
 */

/** The text this user has set, read from whichever of their wallets still has its row. */
export async function ownedAbout(store: Store, userId: string, wallets: string[]): Promise<StoredAbout | null> {
  const addresses = [...new Set([...(await store.members(aboutWalletsKey(userId))), ...wallets.map((w) => w.toLowerCase())])];
  const rows = await store.getMany<StoredAbout>(addresses.map(aboutKey));
  return rows.find((row) => row?.userId === userId) ?? null;
}

/** Writes `row` for each of `wallets` and removes it from wallets the user wrote it for before. */
async function writeRows(store: Store, userId: string, wallets: string[], row: StoredAbout | null) {
  const now = new Set(row ? wallets.map((w) => w.toLowerCase()) : []);
  const before = await store.members(aboutWalletsKey(userId));
  const gone = before.filter((address) => !now.has(address));
  // Only rows this user wrote are removed: a wallet that moved to another user keeps theirs.
  const goneRows = await store.getMany<StoredAbout>(gone.map(aboutKey));
  await store.del(...gone.filter((_, i) => goneRows[i]?.userId === userId).map(aboutKey));
  if (row) await Promise.all([...now].map((address) => store.set(aboutKey(address), row)));
  await store.setMembers(aboutWalletsKey(userId), [...now]);
}

export type SetAboutResult = { ok: true; about: About; wallets: string[] } | { ok: false; reason: "no_wallet" };

/** Keeps `about` for the user's wallets; an empty one removes what was there. */
export async function setAbout(store: Store, userId: string, wallets: Address[], about: About, now = Date.now()): Promise<SetAboutResult> {
  if (wallets.length === 0) return { ok: false, reason: "no_wallet" };
  const lower = wallets.map((w) => w.toLowerCase());
  await writeRows(store, userId, lower, hasAbout(about) ? { ...about, userId, updatedAt: now } : null);
  return { ok: true, about: hasAbout(about) ? about : {}, wallets: lower };
}

export async function clearAbout(store: Store, userId: string) {
  await writeRows(store, userId, [], null);
}

/** Brings the text in line with the user's linked wallets: a new wallet gets it, an unlinked one loses it. Idempotent. */
export async function syncAbout(store: Store, userId: string, wallets: Address[]) {
  const row = await ownedAbout(store, userId, wallets);
  if (!row || wallets.length === 0) {
    if (row || (await store.countMembers(aboutWalletsKey(userId))) > 0) await clearAbout(store, userId);
    return;
  }
  await writeRows(store, userId, wallets.map((w) => w.toLowerCase()), row);
}

/** What a wallet's owner has written, as others see it. */
export async function readAbout(store: Store, address: string): Promise<About | null> {
  const row = await store.get<StoredAbout>(aboutKey(address));
  return row ? { ...(row.name ? { name: row.name } : {}), ...(row.bio ? { bio: row.bio } : {}) } : null;
}
