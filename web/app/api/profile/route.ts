import { linkedEthereumWallets, pickProfile, profileKey, userWalletsKey, type Profile } from "@/lib/profiles";
import { fail, gateUser, json } from "@/lib/server/gate";
import { ownedRows, syncProfile } from "@/lib/server/profileSync";

/**
 * The signed-in user's own shared profile (ADR 0011). Every call needs their Privy access token
 * (`Authorization: Bearer …`). What gets shared is read from Privy by user id, never from the
 * request body, so nobody can publish a handle or wallet that isn't linked to their account.
 *
 *   GET     { enabled, shared?, profile?, stale? }  what is shared now, and what would be
 *   PUT     share it (`{ refresh: true }`: only re-sync a profile that is already shared)
 *   DELETE  stop sharing
 */

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
  const result = await syncProfile(store, user.id, user.linked_accounts, body.refresh === true);

  if (result.shared) return json({ enabled: true, shared: true, profile: result.profile });
  if (result.reason) return fail(422, result.reason, "Link an X or Discord account and a wallet first.");
  return json({ enabled: true, shared: false });
}

export async function DELETE(request: Request) {
  const g = await gateUser(request, "profile", 30);
  if (g instanceof Response) return g;
  const { store, user } = g;

  const owned = await ownedRows(store, user.id, linkedEthereumWallets(user.linked_accounts));
  await store.del(...owned.map((entry) => profileKey(entry.address)), userWalletsKey(user.id));
  return json({ enabled: true, shared: false });
}
