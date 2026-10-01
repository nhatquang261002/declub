import { NotFoundError, PrivyClient, type User } from "@privy-io/node";
import { Webhook } from "svix";
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

/**
 * The signing secret of the webhook endpoint (PRIVY_WEBHOOK_SIGNING_SECRET, `whsec_…`, shown in the
 * dashboard under Configuration > Webhooks once the endpoint is added). Without it the webhook
 * route is off and nothing else changes.
 */
const webhookSecret = process.env.PRIVY_WEBHOOK_SIGNING_SECRET?.trim() || undefined;

export const privyWebhookConfigured = Boolean(privyServerConfigured && webhookSecret);

/**
 * The parsed event if `body` carries a valid Svix signature from Privy (and a timestamp within five
 * minutes), else `null`. `body` must be the raw request text: parsing and re-serializing it first
 * would change the bytes that were signed.
 */
export function verifyWebhook(body: string, headers: Headers): unknown | null {
  if (!webhookSecret) return null;
  try {
    return new Webhook(webhookSecret).verify(body, {
      "svix-id": headers.get("svix-id") ?? "",
      "svix-timestamp": headers.get("svix-timestamp") ?? "",
      "svix-signature": headers.get("svix-signature") ?? "",
    });
  } catch {
    return null;
  }
}

/** A user's current linked accounts, read from Privy by id. `null` if the user no longer exists. */
export async function loadLinkedAccounts(userId: string): Promise<User["linked_accounts"] | null> {
  try {
    return (await client().users()._get(userId)).linked_accounts;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
