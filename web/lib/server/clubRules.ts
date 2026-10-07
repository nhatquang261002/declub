import { CHAIN_ID } from "../config";
import { ownerRulesOf, type ClubRules } from "../rewards";
import type { Store } from "./store";

/**
 * A Club's reward rules (ADR 0040, ADR 0044). The Owner saves the paying ones (`OWNER_RULES`: who is
 * paid and how much of their share); how points are counted is the default, the same in every Club.
 * A change saved during epoch `n` takes effect in `n + 1`, so nobody can move the rules of a race
 * already under way. Every save is kept, so each epoch's rules can be read again, and the epoch
 * publishes the ones it used.
 */

/** One save: the rules from epoch `from` on, until a later save. */
export type SavedRules = { from: number; rules: ClubRules; at: number; by: string };

export const clubRulesKey = (club: string) => `declub:club-rules:${CHAIN_ID}:${club.toLowerCase()}`;
/** The Club members banned from rewards, by user id (ADR 0044). */
export const rewardBansKey = (club: string) => `declub:reward-bans:${CHAIN_ID}:${club.toLowerCase()}`;

/** Saves kept per Club. Years of weekly changes fit. */
const SAVES_KEPT = 200;

export async function rulesHistory(store: Store, club: string): Promise<SavedRules[]> {
  return (await store.get<SavedRules[]>(clubRulesKey(club))) ?? [];
}

/** The latest save in effect at epoch `n`; rules added since it was saved take their defaults. */
const inEffect = (history: readonly SavedRules[], n: number) => history.filter((h) => h.from <= n).sort((a, b) => b.from - a.from || b.at - a.at)[0];

/**
 * The rules Club `club` is scored by in epoch `n`: the only place the epoch builder and the live
 * standings get them from.
 */
export async function rulesFor(store: Store, club: string, n: number): Promise<ClubRules> {
  return ownerRulesOf(inEffect(await rulesHistory(store, club), n)?.rules);
}

/** The rules in effect at epoch `n`, and the change waiting for a later epoch, if there is one. */
export async function rulesView(store: Store, club: string, n: number): Promise<{ current: ClubRules; next: { from: number; rules: ClubRules } | null }> {
  const history = await rulesHistory(store, club);
  const saved = inEffect(history, n);
  const waiting = history.filter((h) => h.from > n).sort((a, b) => b.from - a.from || b.at - a.at)[0];
  return { current: ownerRulesOf(saved?.rules), next: waiting ? { from: waiting.from, rules: ownerRulesOf(waiting.rules) } : null };
}

/** Records `rules` from epoch `from` on, replacing any change already waiting for that epoch or later. */
export async function saveRules(store: Store, club: string, save: SavedRules): Promise<void> {
  const kept = (await rulesHistory(store, club)).filter((h) => h.from < save.from);
  await store.set(clubRulesKey(club), [...kept, save].slice(-SAVES_KEPT));
}

/** A member banned from rewards: their Club wallet when banned, when, and by whom (a wallet). */
export type RewardBan = { wallet: string; at: number; by: string };

export async function rewardBans(store: Store, club: string): Promise<Record<string, RewardBan>> {
  return (await store.get<Record<string, RewardBan>>(rewardBansKey(club))) ?? {};
}
