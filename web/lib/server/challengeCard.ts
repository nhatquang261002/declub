import { isAddress } from "viem";
import { isFlat, phaseOf, type Phase, type StoredChallenge } from "../challenges";
import { shortAddress } from "../format";
import { handleLabel, profileKey, type StoredProfile } from "../profiles";
import { registry } from "../verifiedAssets";
import { challengeKey, entriesKey } from "./challengeState";
import { getStore } from "./store";

/** A winner as the card names them: their handle when they share a profile, else their short wallet. */
export type CardWinner = { name: string; wallet: string; place: number; points: number };

/** What a challenge's preview card says (ADR 0045). */
export type ChallengeFacts = {
  title: string;
  brief: string;
  judging: StoredChallenge["judging"];
  /** Points per place, best first; a flat challenge's are equal ones. */
  prizes: number[];
  phase: Phase;
  endsAt: number;
  entryCount: number;
  /** Winners share one prize (a raffle, first in, everyone who completes; ADR 0049): a list, not a podium. */
  flat: boolean;
  /** A flat challenge's number of winners and points each. */
  places: number;
  prize: number;
  /** At most three best first, or six for a flat challenge; `winnerCount` says how many there are in all. */
  winners: CardWinner[];
  winnerCount: number;
};

/** The Club a card is about, and its challenge when the store has it. */
export type ChallengeCardFacts = { club: string; image?: string; challenge: ChallengeFacts | null };

/** How many winners the card names: the podium's three, or a flat challenge's grid of six. */
const NAMED = 3;
const NAMED_FLAT = 6;

/**
 * What a challenge's link preview needs, read on the server: the stored challenge and its entry
 * count, without settling anything (a likes-judged challenge that has ended but not been settled
 * reads as "results soon"). `null` for an address that has no Club; a Club whose challenge can't be
 * read still has a card, with its name.
 */
export async function readChallengeFacts(address: string, id: string, now = Date.now()): Promise<ChallengeCardFacts | null> {
  if (!isAddress(address, { strict: false })) return null;
  const entry = registry.clubFor(address);
  if (!entry) return null;
  const facts: ChallengeCardFacts = { club: entry.name, image: entry.image, challenge: null };
  const store = getStore();
  if (!store || !/^[0-9a-f-]{36}$/.test(id)) return facts;
  try {
    const token = entry.address.toLowerCase();
    const c = await store.get<StoredChallenge>(challengeKey(token, id));
    if (!c) return facts;
    const phase = phaseOf(c, now);
    const all = [...(c.settled?.winners ?? [])].sort((a, b) => a.place - b.place);
    const shown = all.slice(0, isFlat(c.judging) ? NAMED_FLAT : NAMED);
    const [members, profiles] = await Promise.all([
      phase === "cancelled" ? Promise.resolve([] as string[]) : store.members(entriesKey(token, id)),
      store.getMany<StoredProfile>(shown.map((w) => profileKey(w.wallet))),
    ]);
    facts.challenge = {
      title: c.title,
      brief: c.brief,
      judging: c.judging,
      prizes: c.prizes,
      phase,
      endsAt: c.endsAt,
      entryCount: members.length,
      flat: isFlat(c.judging),
      places: c.winners ?? c.prizes.length,
      prize: c.prize ?? c.prizes[0] ?? 0,
      winners: shown.map((w, i) => ({ name: profiles[i] ? handleLabel(profiles[i]!) : shortAddress(w.wallet), wallet: w.wallet.toLowerCase(), place: w.place, points: w.points })),
      winnerCount: all.length,
    };
  } catch {
    // The challenge is a bonus: the card still names the Club.
  }
  return facts;
}
