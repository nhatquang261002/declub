import { randomUUID } from "node:crypto";
import { CHAIN_ID } from "../config";
import { NO_PROFILE, type ClubProfile } from "../clubPosts";
import { NO_ROLES, type Roles } from "../clubRoles";
import type { Store } from "./store";

/**
 * What a Club keeps besides members and posts: its roles, its profile, its bans and its moderation
 * log (docs/09-clubs.md). Each is one small document per Club, read and rewritten whole: they
 * change rarely and by staff only, so a lost race between two staff edits costs nothing that the
 * log doesn't show.
 */
const base = (token: string) => `${CHAIN_ID}:${token.toLowerCase()}`;
export const rolesKey = (token: string) => `ondeal:club-roles:${base(token)}`;
export const clubProfileKey = (token: string) => `ondeal:club-profile:${base(token)}`;
export const logKey = (token: string) => `ondeal:club-log:${base(token)}`;
/** Bans from one Club, or from every Club (`ALL`). */
export const ALL = "all";
export const banKey = (token: string) => `ondeal:club-ban:${token === ALL ? ALL : base(token)}`;

/** The app admins: Privy user ids in CLUB_ADMIN_USER_IDS, comma separated. */
export function adminIds(env: string | undefined = process.env.CLUB_ADMIN_USER_IDS): Set<string> {
  return new Set((env ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

export async function loadRoles(store: Store, token: string): Promise<Roles> {
  const stored = await store.get<Roles>(rolesKey(token));
  return stored ? { ...(stored.owner ? { owner: stored.owner } : {}), moderators: stored.moderators ?? [] } : NO_ROLES;
}
export const saveRoles = (store: Store, token: string, roles: Roles) => store.set(rolesKey(token), roles);

export async function loadProfile(store: Store, token: string): Promise<ClubProfile> {
  return { ...NO_PROFILE, ...(await store.get<Partial<ClubProfile>>(clubProfileKey(token))) };
}
export const saveProfile = (store: Store, token: string, profile: ClubProfile) => store.set(clubProfileKey(token), profile);

export type Ban = { wallet: string; at: number; by: string };
export type Bans = Record<string, Ban>;

export async function loadBans(store: Store, token: string): Promise<Bans> {
  return (await store.get<Bans>(banKey(token))) ?? {};
}
export const saveBans = (store: Store, token: string, bans: Bans) =>
  Object.keys(bans).length === 0 ? store.del(banKey(token)) : store.set(banKey(token), bans);

/** Banned from this Club, or from all of them. */
export async function isBanned(store: Store, token: string, userId: string): Promise<boolean> {
  const [here, everywhere] = await Promise.all([loadBans(store, token), loadBans(store, ALL)]);
  return userId in here || userId in everywhere;
}

/** One line of the moderation log. Wallets, not user ids: staff read this. */
export type LogEntry = { id: string; at: number; actor: string; action: string; target?: string; detail?: string };
export const LOG_KEPT = 1_000;

// Two actions in the same millisecond must still read newest-first, and a ranked set breaks ties
// by member text, which here starts with nothing orderly: so each entry gets a strictly later time.
let lastAt = 0;

export async function appendLog(store: Store, token: string, entry: Omit<LogEntry, "id" | "at">, now = Date.now()): Promise<void> {
  const at = Math.max(now, lastAt + 1);
  lastAt = at;
  const full: LogEntry = { id: randomUUID(), at, ...entry };
  await store.rank(logKey(token), [{ member: JSON.stringify(full), score: at }], LOG_KEPT);
}

export async function readLog(store: Store, token: string, limit = 200): Promise<LogEntry[]> {
  return (await store.ranked(logKey(token), limit)).flatMap((raw) => {
    try {
      return [JSON.parse(raw) as LogEntry];
    } catch {
      return [];
    }
  });
}
