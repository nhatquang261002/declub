import { syncProfile } from "./profileSync";
import type { Store } from "./store";

/**
 * Privy webhooks that keep verified profiles in step with the user's linked accounts (ADR 0013).
 * Only user events matter: they fire for every wallet type, unlike transaction events, which cover
 * Privy embedded wallets only.
 */

/** Looks a user's current linked accounts up at Privy. `null` when the user no longer exists. */
export type LoadAccounts = (userId: string) => Promise<readonly { type: string }[] | null>;

const SYNC_EVENTS = new Set([
  "user.linked_account",
  "user.unlinked_account",
  // An account moved from one user to another: the old owner loses the wallet or handle.
  "user.transferred_account",
  // Deleted, or merged into another user (the merge also reports a transfer).
  "user.deleted",
]);

const ID = /^[A-Za-z0-9]{1,64}$/;

/** The user ids an event says may have changed. Anything that isn't a plain id is ignored. */
export function affectedUsers(event: unknown): string[] {
  if (typeof event !== "object" || event === null) return [];
  const e = event as Record<string, unknown>;
  if (typeof e.type !== "string" || !SYNC_EVENTS.has(e.type)) return [];
  const ref = (value: unknown) => (typeof value === "object" && value !== null ? (value as { id?: unknown }).id : undefined);
  const ids = e.type === "user.transferred_account" ? [ref(e.fromUser), ref(e.toUser)] : [ref(e.user)];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && ID.test(id)))];
}

/**
 * Re-syncs every user the event names. The payload only says *who* changed: the state is read
 * again from Privy. Webhooks are delivered at least once and can arrive late or out of order, so a
 * replayed "linked" event arriving after the account was unlinked must not bring the profile back,
 * and reading the current accounts makes every delivery harmless.
 *
 * Only shares that already exist are touched (`refresh`): a webhook never publishes anyone.
 * Throws when Privy or the store fails, so the caller answers non-2xx and Privy retries.
 */
export async function handlePrivyEvent(event: unknown, store: Store, load: LoadAccounts): Promise<string[]> {
  const users = affectedUsers(event);
  for (const userId of users) {
    const accounts = await load(userId);
    await syncProfile(store, userId, accounts ?? [], true);
  }
  return users;
}
