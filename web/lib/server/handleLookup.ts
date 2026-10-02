import { getAddress } from "viem";
import { parseHandleQuery, profileKey, userWalletsKey, type HandleMatch, type ProfileProvider, type StoredProfile } from "../profiles";
import { fail, gateUser, json, type UserGate } from "./gate";
import { findUserIdByHandle } from "./privy";
import type { Store } from "./store";

/**
 * "Make a deal for @handle" (ADR 0017): find the wallets of the trader behind an X or Discord
 * handle, so a private deal can be locked to them. Privy says which user linked the handle; the
 * store says which of their wallets they chose to show under it. Someone who never shared a
 * profile can't be found, so this reveals nothing beyond what `/api/profiles` already shows.
 */

/** Looks up the Privy user who linked a username. Privy in production; a stand-in in tests. */
export type FindUser = (provider: ProfileProvider, username: string) => Promise<string | null>;

export type LookupResult = {
  matches: HandleMatch[];
  /** The handle is the caller's own. */
  self: boolean;
};

/**
 * The wallets `userId` shares under exactly this profile. A row written before a rename (and not
 * yet re-synced) shows another handle, so it doesn't count: a lookup by the new handle would
 * otherwise lock a deal to a wallet that traders still see under the old one.
 */
async function walletsSharedAs(store: Store, userId: string, provider: ProfileProvider, username: string): Promise<HandleMatch | null> {
  const wallets = await store.members(userWalletsKey(userId));
  const rows = await store.getMany<StoredProfile>(wallets.map(profileKey));
  const shown = rows.filter(
    (row): row is StoredProfile =>
      row?.userId === userId && row.provider === provider && row.handle.toLowerCase() === username.toLowerCase(),
  );
  if (shown.length === 0) return null;
  const matching = wallets.filter((_, i) => shown.includes(rows[i]!));
  return { provider, handle: shown[0].handle, wallets: matching.map((w) => getAddress(w)) };
}

/** Everyone who shares a profile under `query`, X first. `null` when `query` can't be a handle. */
export async function lookupHandle(store: Store, callerId: string, query: string, find: FindUser): Promise<LookupResult | null> {
  const usernames = parseHandleQuery(query);
  if (!usernames) return null;
  const providers = (["twitter", "discord"] as const).filter((p) => usernames[p]);
  const ids = await Promise.all(providers.map((p) => find(p, usernames[p]!)));

  const result: LookupResult = { matches: [], self: false };
  for (const [i, provider] of providers.entries()) {
    const id = ids[i];
    if (!id) continue;
    if (id === callerId) {
      result.self = true;
      continue;
    }
    const match = await walletsSharedAs(store, id, provider, usernames[provider]!);
    if (match) result.matches.push(match);
  }
  return result;
}

export type LookupDeps = {
  gate?: (request: Request, name: string, limit: number) => Promise<UserGate>;
  find?: FindUser;
};

/**
 * GET /api/profiles/lookup?handle=@bob   { enabled, matches: [{provider, handle, wallets}], self }
 * Signed-in only and rate limited, so handles can't be swept anonymously.
 */
export function lookupHandler(deps: LookupDeps = {}) {
  return async function GET(request: Request) {
    const g = await (deps.gate ?? gateUser)(request, "handle-lookup", 30);
    if (g instanceof Response) return g;
    const handle = new URL(request.url).searchParams.get("handle") ?? "";
    try {
      const result = await lookupHandle(g.store, g.user.id, handle, deps.find ?? findUserIdByHandle);
      if (!result) return fail(400, "bad_request", "Enter an X or Discord handle.");
      return json({ enabled: true, ...result });
    } catch {
      return fail(502, "lookup_failed", "Couldn't look that handle up. Try again.");
    }
  };
}
