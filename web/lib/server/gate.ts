import type { User } from "@privy-io/node";
import { privyServerConfigured, userById, verifiedUserId } from "./privy";
import { clientId, getStore, withinLimit, type Store } from "./store";

const NO_STORE = { "Cache-Control": "no-store" };

/** A JSON response that is never cached: these answers are per user. */
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
export const fail = (status: number, error: string, message: string) => json({ error, message }, status);

export type UserGate = { store: Store; user: User } | Response;

const limited = () => fail(429, "rate_limited", "Too many requests. Try again in a minute.");

/**
 * The common front of every per-user route: the feature has a store and a Privy secret (else it
 * answers `{ enabled: false }` so the app falls back to local state), the caller is within `limit`
 * requests a minute, and the request carries a valid Privy access token.
 *
 * The limit is counted twice, in this order: by IP before anything else (so an unauthenticated
 * flood never reaches token checks), then by Privy user id once the token's signature checks out
 * and before the user is read from Privy (so one account can't spread its calls over many IPs).
 */
export async function gateUser(request: Request, name: string, limit = 60): Promise<UserGate> {
  const store = getStore();
  if (!store || !privyServerConfigured) return json({ enabled: false });
  if (!(await withinLimit(store, name, clientId(request), limit, 60))) return limited();
  const userId = await verifiedUserId(request);
  if (!userId) return fail(401, "unauthorized", "Sign in again to continue.");
  if (!(await withinLimit(store, `${name}:user`, userId, limit, 60))) return limited();
  const user = await userById(userId);
  if (!user) return fail(401, "unauthorized", "Sign in again to continue.");
  return { store, user };
}
