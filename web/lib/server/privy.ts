import { PrivyClient, type User } from "@privy-io/node";
import { PRIVY_APP_ID } from "../config";

/**
 * Server-side Privy. Needs the app secret (PRIVY_APP_SECRET, from the Privy dashboard) beside the
 * public app id. Without both, anything built on it reports itself as off rather than failing.
 * Put the secret in web/.env.local or the host's environment: the root .env is only read for its
 * NEXT_PUBLIC_ values (next.config.ts).
 */
const secret = process.env.PRIVY_APP_SECRET?.trim() || undefined;

export const privyServerConfigured = Boolean(PRIVY_APP_ID && secret);

let cached: PrivyClient | undefined;
function client(): PrivyClient {
  return (cached ??= new PrivyClient({ appId: PRIVY_APP_ID!, appSecret: secret! }));
}

/**
 * The user behind `Authorization: Bearer <Privy access token>`, or `null` for a missing, expired
 * or forged token. The token is checked against the app's keys; the linked accounts are then read
 * from Privy by user id, never taken from the request.
 */
export async function authenticate(request: Request): Promise<User | null> {
  if (!privyServerConfigured) return null;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  try {
    const claims = await client().utils().auth().verifyAccessToken(token);
    return await client().users()._get(claims.user_id);
  } catch {
    return null;
  }
}
