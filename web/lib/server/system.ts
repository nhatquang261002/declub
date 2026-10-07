import { mergeClubs, newest, SYSTEM_WINDOW_SEC, systemKindOf, type SystemEvent } from "../systemFeed";
import type { ClubEntry } from "../verifiedAssets";
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
    return [{ id: e.id, clubs: [club], kind, at: e.at, wallets: [...new Set(e.parties.map((p) => p.toLowerCase()))], deal: e.deal, ...(signed ? { signed: true as const } : {}) }];
  });
  const joined = rows
    // A row's joinedAt is epoch ms.
    .filter((row) => Math.floor(row.joinedAt / 1000) > since)
    .map((row): SystemEvent => ({ id: `join:${club}:${row.displayWallet}`, clubs: [club], kind: "join", at: Math.floor(row.joinedAt / 1000), wallets: [row.displayWallet] }));
  return [...logged, ...joined];
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
