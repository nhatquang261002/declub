import { mergeClubs, newest, SYSTEM_WINDOW_SEC, systemKindOf, type SystemEvent } from "../systemFeed";
import type { ClubEntry } from "../verifiedAssets";
import type { StoredChallenge } from "../challenges";
import { challengeKey, challengesKey } from "./challengeState";
import { clubEvents, type Deps } from "./clubs";
import { allRows } from "./members";
import type { Store } from "./store";

/** One Club's system messages inside the window, in no particular order. */
async function ofClub(store: Store, entry: ClubEntry, now: number, deps: Deps): Promise<SystemEvent[]> {
  const club = entry.address.toLowerCase();
  const since = now - SYSTEM_WINDOW_SEC;
  const [events, rows] = await Promise.all([clubEvents(store, entry, deps).catch(() => []), allRows(store, club).catch(() => [])]);

  const logged = events.flatMap((e): SystemEvent[] => {
    const kind = systemKindOf(e);
    if (!kind || e.at <= since) return [];
    // A signed swap is logged as `<tx>:settled` (lib/clubs.ts): its `deal` is the transaction.
    const signed = kind === "swap" && e.id.endsWith(":settled");
    return [
      {
        id: e.id,
        clubs: [club],
        kind,
        at: e.at,
        wallets: [...new Set(e.parties.map((p) => p.toLowerCase()))],
        deal: e.deal,
        ...(signed ? { signed: true as const } : {}),
      },
    ];
  });
  const joined = rows
    // A row's joinedAt is epoch ms.
    .filter((row) => Math.floor(row.joinedAt / 1000) > since)
    .map((row): SystemEvent => ({
      id: `join:${club}:${row.displayWallet}`,
      clubs: [club],
      kind: "join",
      at: Math.floor(row.joinedAt / 1000),
      wallets: [row.displayWallet],
    }));
  return [...logged, ...joined, ...(await challengeEvents(store, club, since))];
}

/**
 * A Club's challenges as messages (ADR 0045): one when the Owner started it (not if it was cancelled),
 * one when it was won. A win is told at the challenge's end, an Owner's pick when it was made.
 */
async function challengeEvents(store: Store, club: string, since: number): Promise<SystemEvent[]> {
  let all: StoredChallenge[] = [];
  try {
    const ids = await store.ranked(challengesKey(club), 30);
    all = (await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(club, id)))).filter((c): c is StoredChallenge => !!c);
  } catch {
    // A Club whose challenges can't be read leaves them out of its messages.
  }
  return all.flatMap((c): SystemEvent[] => {
    const out: SystemEvent[] = [];
    const startedAt = Math.floor(c.startsAt / 1000);
    if (c.state !== "cancelled" && startedAt > since)
      out.push({ id: `challenge:${c.id}`, clubs: [club], kind: "challenge", at: startedAt, wallets: [c.by.toLowerCase()], challenge: c.id, title: c.title });
    const winners = c.settled?.winners ?? [];
    const wonAt = c.settled ? Math.floor((c.judging !== "owner" ? Math.min(c.endsAt, c.settled.at) : c.settled.at) / 1000) : 0;
    if (winners.length > 0 && wonAt > since)
      out.push({
        id: `challenge-won:${c.id}`,
        clubs: [club],
        kind: "winner",
        at: wonAt,
        wallets: winners.map((w) => w.wallet.toLowerCase()),
        challenge: c.id,
        title: c.title,
      });
    return out;
  });
}

/**
 * The newest system messages of `entries` as one list, newest first, with the moment it is
 * complete from (lib/systemFeed.ts `newest`). An event in several of them comes once. A Club that
 * can't be read leaves its messages out rather than failing the rest.
 */
export async function listSystem(store: Store, entries: readonly ClubEntry[], deps: Deps = {}): Promise<{ events: SystemEvent[]; since: number }> {
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const all = (await Promise.all(entries.map((entry) => ofClub(store, entry, now, deps)))).flat();
  return newest(mergeClubs(all), now);
}
