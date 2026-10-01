import {
  linkedEthereumWallets,
  pickProfile,
  profileKey,
  userWalletsKey,
  type Profile,
  type StoredProfile,
} from "@/lib/profiles";
import { fail, gateUser, json } from "@/lib/server/gate";
import type { Store } from "@/lib/server/store";

/**
 * The signed-in user's own shared profile (ADR 0011). Every call needs their Privy access token
 * (`Authorization: Bearer …`). What gets shared is read from Privy by user id, never from the
 * request body, so nobody can publish a handle or wallet that isn't linked to their account.
 *
 *   GET     { enabled, shared?, profile?, stale? }  what is shared now, and what would be
 *   PUT     share it (`{ refresh: true }`: only re-sync a profile that is already shared)
 *   DELETE  stop sharing
 */

/** The rows this user has written, whichever of their wallets they were for. */
async function ownedRows(store: Store, userId: string, wallets: string[]) {
  const addresses = new Set([...(await store.members(userWalletsKey(userId))), ...wallets.map((w) => w.toLowerCase())]);
  const list = [...addresses];
  const rows = await store.getMany<StoredProfile>(list.map(profileKey));
  return list.map((address, i) => ({ address, row: rows[i] })).filter((entry) => entry.row?.userId === userId);
}

export async function GET(request: Request) {
  const g = await gateUser(request, "profile", 30);
  if (g instanceof Response) return g;
  const { store, user } = g;

  const wallets = linkedEthereumWallets(user.linked_accounts);
  const available = pickProfile(user.linked_accounts);
  const owned = await ownedRows(store, user.id, wallets);
  const shared = owned[0]?.row;
  const profile: Profile | undefined = shared ? { provider: shared.provider, handle: shared.handle } : undefined;
  return json({
    enabled: true,
    shared: owned.length > 0,
    profile,
    /** What sharing would show right now. */
    available,
    /** Shared, but the linked account or wallets have changed since. */
    stale:
      owned.length > 0 &&
      (shared?.handle !== available?.handle ||
        shared?.provider !== available?.provider ||
        wallets.some((w) => !owned.some((o) => o.address === w.toLowerCase()))),
  });
}

export async function PUT(request: Request) {
  const g = await gateUser(request, "profile", 30);
  if (g instanceof Response) return g;
  const { store, user } = g;

  const body = (await request.json().catch(() => ({}))) as { refresh?: unknown };
  const refresh = body.refresh === true;

  const wallets = linkedEthereumWallets(user.linked_accounts);
  const profile = pickProfile(user.linked_accounts);
  const owned = await ownedRows(store, user.id, wallets);

  // Rows for wallets that are no longer linked, or that have nothing left to show, go away.
  const keep = profile ? new Set(wallets.map((w) => w.toLowerCase())) : new Set<string>();
  const stale = owned.filter((entry) => !keep.has(entry.address));
  await store.del(...stale.map((entry) => profileKey(entry.address)));

  if (!profile || wallets.length === 0) {
    await store.setMembers(userWalletsKey(user.id), []);
    if (refresh) return json({ enabled: true, shared: false });
    return fail(422, "nothing_to_share", "Link an X or Discord account and a wallet first.");
  }
  // A refresh keeps an existing share up to date; it never starts one.
  if (refresh && owned.length === 0) return json({ enabled: true, shared: false });

  const row: StoredProfile = { ...profile, userId: user.id, updatedAt: Date.now() };
  await Promise.all(wallets.map((wallet) => store.set(profileKey(wallet), row)));
  await store.setMembers(userWalletsKey(user.id), wallets.map((w) => w.toLowerCase()));
  return json({ enabled: true, shared: true, profile });
}

export async function DELETE(request: Request) {
  const g = await gateUser(request, "profile", 30);
  if (g instanceof Response) return g;
  const { store, user } = g;

  const owned = await ownedRows(store, user.id, linkedEthereumWallets(user.linked_accounts));
  await store.del(...owned.map((entry) => profileKey(entry.address)), userWalletsKey(user.id));
  return json({ enabled: true, shared: false });
}
