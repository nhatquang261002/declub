import { CHAIN_ID } from "../config";
import { CHALLENGE_CAP_PER_EPOCH, CHALLENGE_RULES, countedPoints, likesDecide, type ChallengeAward, type StoredChallenge, type Trophy } from "../challenges";
import type { Store } from "./store";

/**
 * Where Club challenges are kept (ADR 0045), apart from what runs them so the Board (which locks
 * the likes of a finished challenge) and the rewards builder (which reads the points) can read it
 * without importing the code that settles them.
 */
const base = (club: string) => `declub:challenge:${CHAIN_ID}:${club.toLowerCase()}`;

/** A Club's challenge ids, ranked by when they started. */
export const challengesKey = (club: string) => `${base(club)}:list`;
export const challengeKey = (club: string, id: string) => `${base(club)}:c:${id}`;
/** The entries of one challenge, as `postId|userId`. */
export const entriesKey = (club: string, id: string) => `${base(club)}:entries:${id}`;
/** Every post ever entered in a challenge, withdrawn ones too: the posts its prize covers (ADR 0048). */
export const enteredKey = (club: string, id: string) => `${base(club)}:entered:${id}`;
/** The challenge a Board post was entered in, by post id. */
export const entryOfKey = (club: string, post: string) => `${base(club)}:entry-of:${post}`;
/** The points won in a Club in epoch `n`, by user id. */
export const awardsKey = (club: string, n: number) => `${base(club)}:awards:${n}`;
export const settleLockKey = (club: string, id: string) => `${base(club)}:settle:${id}`;

/** A member's trophies across Clubs (ADR 0050), by user id: one per challenge won, newest first. */
export const trophiesKey = (userId: string) => `declub:challenge:${CHAIN_ID}:trophies:${userId}`;
/** A transaction that paid an asset prize: it pays one prize only (ADR 0050). */
export const prizeTxKey = (tx: string) => `declub:challenge:${CHAIN_ID}:prize-tx:${tx.toLowerCase()}`;
/** At most this many trophies are kept for a member. */
export const TROPHIES_KEPT = 200;

export async function readTrophies(store: Store, userId: string): Promise<Trophy[]> {
  return (await store.get<Trophy[]>(trophiesKey(userId))) ?? [];
}

/**
 * Records `trophy` for `userId`, replacing one already kept for the same challenge, so settling a
 * challenge twice gives one trophy.
 */
export async function addTrophy(store: Store, userId: string, trophy: Trophy): Promise<void> {
  const kept = (await readTrophies(store, userId)).filter((t) => !(t.club === trophy.club && t.challenge === trophy.challenge));
  await store.set(trophiesKey(userId), [trophy, ...kept].sort((a, b) => b.at - a.at).slice(0, TROPHIES_KEPT));
}

export type EpochAwards = Record<string, ChallengeAward>;

export async function readAwards(store: Store, club: string, n: number): Promise<EpochAwards> {
  return (await store.get<EpochAwards>(awardsKey(club, n))) ?? {};
}

/** What one member's challenge wins count for in an epoch, capped (ADR 0045). */
export const awardedPoints = (award: ChallengeAward | undefined) => countedPoints(award?.points ?? 0);

/** One win, as an epoch publishes it: by public wallet, with the challenge it came from. */
export type PublishedAward = { challenge: string; title: string; wallet: string; place: number; points: number };

/** Every win in an epoch for a Club, for the published ledger, and the cap that applied. */
export function publishAwards(awards: EpochAwards): { cap: number; wins: PublishedAward[] } {
  const wins = Object.values(awards)
    .flatMap((a) => a.wins.map((w) => ({ challenge: w.challenge, title: w.title, wallet: a.wallet.toLowerCase(), place: w.place, points: w.points })))
    .sort((x, y) => (x.challenge === y.challenge ? x.place - y.place : x.challenge < y.challenge ? -1 : 1));
  return { cap: CHALLENGE_CAP_PER_EPOCH, wins };
}

/**
 * Whether the likes on Board post `post` are locked: it is an entry of a challenge whose likes decide
 * the winners (by likes, by Holders' likes, or "everyone who completes" asking for likes: `likesDecide`,
 * ADR 0049) that has ended, so the tally can't move between the end and the settling.
 */
export async function votingClosed(store: Store, club: string, post: string, now: number): Promise<boolean> {
  const id = await store.get<string>(entryOfKey(club, post));
  if (!id) return false;
  const challenge = await store.get<StoredChallenge>(challengeKey(club, id));
  return !!challenge && likesDecide(challenge) && challenge.state !== "cancelled" && now >= challenge.endsAt;
}

/**
 * Whether `actor` and `target` have both entered the same challenge that is still running or being
 * judged (ADR 0045). A Moderator who has entered can't hide, delete or ban a rival there: the Owner
 * or another Moderator has to, so staff can't clear the field for themselves.
 */
export async function rivals(store: Store, club: string, actor: string, target: string): Promise<boolean> {
  if (actor === target) return false;
  const ids = await store.ranked(challengesKey(club), CHALLENGE_RULES.kept);
  const live = (await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(club, id)))).filter((c): c is StoredChallenge => c?.state === "live");
  for (const c of live) {
    const users = new Set((await store.members(entriesKey(club, c.id))).map((m) => m.slice(m.indexOf("|") + 1)));
    if (users.has(actor) && users.has(target)) return true;
  }
  return false;
}
