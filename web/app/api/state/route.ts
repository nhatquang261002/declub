import { linkedEthereumWallets } from "@/lib/profiles";
import { fail, gateUser, json } from "@/lib/server/gate";
import {
  isAddressString,
  isSeenKey,
  MAX_RECENTS,
  MAX_SEEN_ACCOUNT_KEYS,
  MAX_SEEN_PER_REQUEST,
  onlyValid,
  recentsKey,
  seenInitKey,
  seenKey,
} from "@/lib/state";

/**
 * The signed-in user's saved state (ADR 0012). Every call needs their Privy access token, and a
 * wallet named in a call must be one linked to that account.
 *
 *   GET    ?account=0x…   { enabled, seen, initialized, recents }
 *   POST   { account?, seen?, initialized?, recents? }   add to it; nothing is ever replaced
 *   DELETE                 forget all of it
 */

export async function GET(request: Request) {
  const g = await gateUser(request, "state");
  if (g instanceof Response) return g;
  const { store, user } = g;

  const account = new URL(request.url).searchParams.get("account");
  let seen: string[] = [];
  let initialized = false;
  if (account) {
    if (!isAddressString(account) || !linkedEthereumWallets(user.linked_accounts).some((w) => w.toLowerCase() === account.toLowerCase())) {
      return fail(403, "forbidden", "That wallet isn't linked to this account.");
    }
    [seen, initialized] = await Promise.all([
      store.ranked(seenKey(user.id, account), MAX_SEEN_ACCOUNT_KEYS),
      store.get<number>(seenInitKey(user.id, account)).then((v) => v !== null),
    ]);
  }
  const recents = await store.ranked(recentsKey(user.id), MAX_RECENTS);
  return json({ enabled: true, seen, initialized, recents });
}

export async function POST(request: Request) {
  const g = await gateUser(request, "state");
  if (g instanceof Response) return g;
  const { store, user } = g;

  const body = (await request.json().catch(() => ({}))) as {
    account?: unknown;
    seen?: unknown;
    initialized?: unknown;
    recents?: unknown;
  };
  const now = Date.now();

  const seen = onlyValid(body.seen, isSeenKey, MAX_SEEN_PER_REQUEST);
  if (seen.length > 0 || body.initialized === true) {
    const account = body.account;
    if (!isAddressString(account) || !linkedEthereumWallets(user.linked_accounts).some((w) => w.toLowerCase() === account.toLowerCase())) {
      return fail(403, "forbidden", "That wallet isn't linked to this account.");
    }
    if (seen.length > 0) {
      // Sending a key again only refreshes its age; the oldest ones age out past the cap.
      await store.rank(seenKey(user.id, account), seen.map((member) => ({ member, score: now })), MAX_SEEN_ACCOUNT_KEYS);
    }
    if (body.initialized === true) await store.set(seenInitKey(user.id, account), 1);
  }

  // Newest first in the request. Scores step back from now so that order survives.
  const recents = onlyValid(body.recents, isAddressString, MAX_RECENTS);
  if (recents.length > 0) {
    await store.rank(
      recentsKey(user.id),
      recents.map((address, i) => ({ member: address.toLowerCase(), score: now - i })),
      MAX_RECENTS,
    );
  }
  return json({ enabled: true });
}

export async function DELETE(request: Request) {
  const g = await gateUser(request, "state");
  if (g instanceof Response) return g;
  const { store, user } = g;

  const keys = linkedEthereumWallets(user.linked_accounts).flatMap((wallet) => [seenKey(user.id, wallet), seenInitKey(user.id, wallet)]);
  await store.del(recentsKey(user.id), ...keys);
  return json({ enabled: true });
}
