import { DEFAULT_CLUB_RULES, type ClubRules } from "../rewards";
import type { Store } from "./store";

/**
 * The rules Club `club` is scored by in epoch `n` (ADR 0040): the only place the epoch builder and
 * the live standings get them from. Every Club uses the defaults for now. When Owners can set their
 * own, this reads what they saved, and a change saved in epoch `n` takes effect in `n + 1`, so an
 * Owner can't move the floor in a race that is already under way.
 */
// The arguments are unused until Owners can save their own rules.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function rulesFor(_store: Store, _club: string, _n: number): Promise<ClubRules> {
  return DEFAULT_CLUB_RULES;
}
