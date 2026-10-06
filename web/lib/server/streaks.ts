import { CHAIN_ID } from "../config";
import type { Store } from "./store";

/**
 * Streaks (ADR 0032): how many epochs in a row a member had at least `REWARDS.streakMinDays` active
 * days in a Club. Kept per Club by the epoch builder, which is the only writer and builds each epoch
 * once and in order, so a rebuild agrees.
 */

/** Each member's streak in a Club, by user id: the last qualifying epoch and how many in a row it ends. */
export const streaksKey = (club: string) => `declub:rewards:${CHAIN_ID}:streaks:${club.toLowerCase()}`;

/** A Club's cached live standings (./standings.ts). Kept here, with the other per-Club rewards keys a purge clears. */
export const standingsKey = (club: string) => `declub:rewards:${CHAIN_ID}:standings:${club.toLowerCase()}`;

export type Streak = { n: number; count: number };
export type Streaks = Record<string, Streak>;

export const readStreaks = async (store: Store, club: string) => (await store.get<Streaks>(streaksKey(club))) ?? {};

/**
 * A member's streak counting epoch `n` (not yet stored): one more than the last if that was `n − 1`,
 * a fresh 1 otherwise, 0 if `n` doesn't qualify (`qualified`).
 */
export function streakAt(prev: Streak | undefined, n: number, qualified: boolean): number {
  if (!qualified) return 0;
  return prev && prev.n === n - 1 ? prev.count + 1 : 1;
}

/** A member's streak as of now, for badges: still alive if it ended in epoch `current` or the one before. */
export function liveStreak(prev: Streak | undefined, current: number): number {
  return prev && prev.n >= current - 1 ? prev.count : 0;
}

/** The streaks after epoch `n` is built: qualifying members advance, everyone else keeps theirs (and lets it lapse). */
export function nextStreaks(prev: Streaks, n: number, qualifiedUsers: Iterable<string>): Streaks {
  const out: Streaks = { ...prev };
  for (const userId of qualifiedUsers) out[userId] = { n, count: streakAt(prev[userId], n, true) };
  return out;
}
