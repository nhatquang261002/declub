import { cleanLine } from "./clubPosts";

/**
 * Club challenges (ADR 0045, docs/09-clubs.md#challenges): the Owner sets the Club a task at any
 * time, members answer it with a Board post, and the winners earn activity points for the epoch the
 * challenge ends in. Pure, so the server, the screens and the tests share one set of rules. The
 * points are the Owner's to set, within bounds, and they count like any other activity points
 * (`activityPoints`, lib/rewards.ts): they raise the bonus and the ramp, never pay anyone directly.
 */
export const CHALLENGE_RULES = {
  /** At most this many places pay, best first. */
  maxPlaces: 3,
  /** The most points one place can pay. */
  maxPoints: 20,
  /** How long a challenge may run: an hour to a month. */
  minHours: 1,
  maxHours: 24 * 30,
  /** Open at once, so a Club's Board isn't buried. */
  maxOpen: 3,
  /** The title and the brief, in characters. */
  titleMax: 60,
  briefMax: 280,
  /** At most this many entries a challenge keeps. */
  maxEntries: 200,
  /** A challenge judged by the Owner expires with no winners if they don't pick within this long after it ends (ms). */
  pickWindowMs: 14 * 86_400_000,
  /** A challenge judged by likes needs at least this many from other members to have a winner. */
  minLikes: 1,
  /** Challenges kept per Club; older ones fall off the list. */
  kept: 100,
} as const;

/**
 * At most this many challenge points count for one member in one epoch, whatever they won: a
 * Club's challenges can top up a member's points, not make them. Lives with the protocol rules'
 * spirit (the Owner can't raise it) and is applied where an epoch's inputs are read.
 */
export const CHALLENGE_CAP_PER_EPOCH = 20;

/** Who decides the winners: the members' likes, or the Owner's pick after the end. */
export type Judging = "likes" | "owner";

export type ChallengeInput = {
  title: string;
  brief: string;
  judging: Judging;
  /** Points per place, best first. */
  prizes: number[];
  /** How long it runs from now, in hours. */
  hours: number;
};

export type CheckedChallenge = Omit<ChallengeInput, "hours"> & { hours: number };

/** Checks what an Owner sent to start a challenge. */
export function checkChallenge(input: unknown): { ok: true; challenge: CheckedChallenge } | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, message: "Send the challenge as an object." };
  const { title, brief, judging, prizes, hours } = input as Record<string, unknown>;
  const t = cleanLine(title, CHALLENGE_RULES.titleMax);
  if (!t.ok) return { ok: false, message: t.reason === "empty" ? "Give the challenge a title." : `The title is at most ${CHALLENGE_RULES.titleMax} characters.` };
  const b = cleanLine(brief, CHALLENGE_RULES.briefMax);
  if (!b.ok) return { ok: false, message: b.reason === "empty" ? "Say what members should do." : `The brief is at most ${CHALLENGE_RULES.briefMax} characters.` };
  if (judging !== "likes" && judging !== "owner") return { ok: false, message: "Winners are picked by likes or by the Owner." };
  if (!Array.isArray(prizes) || prizes.length < 1 || prizes.length > CHALLENGE_RULES.maxPlaces) {
    return { ok: false, message: `Pay between 1 and ${CHALLENGE_RULES.maxPlaces} places.` };
  }
  let last = Infinity;
  for (const p of prizes) {
    if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > CHALLENGE_RULES.maxPoints) {
      return { ok: false, message: `Each place pays a whole number of points, 1 to ${CHALLENGE_RULES.maxPoints}.` };
    }
    if (p > last) return { ok: false, message: "A lower place can't pay more than a higher one." };
    last = p;
  }
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < CHALLENGE_RULES.minHours || hours > CHALLENGE_RULES.maxHours) {
    return { ok: false, message: `It runs for ${CHALLENGE_RULES.minHours} hour to ${CHALLENGE_RULES.maxHours / 24} days.` };
  }
  return { ok: true, challenge: { title: t.text, brief: b.text, judging, prizes: prizes as number[], hours } };
}

/** What the server keeps for one challenge. `userId`s never leave the server. */
export type StoredChallenge = {
  id: string;
  title: string;
  brief: string;
  judging: Judging;
  prizes: number[];
  /** Epoch ms. Entries must be posted in `[startsAt, endsAt)`. */
  startsAt: number;
  endsAt: number;
  /** The Owner's (or admin's) wallet when they started it. */
  by: string;
  state: "live" | "settled" | "cancelled";
  settled?: Settlement;
};

export type Winner = { post: string; wallet: string; place: number; points: number; likes?: number };

/** How a challenge ended: who won and the epoch their points count in. */
export type Settlement = {
  at: number;
  /** The epoch the points count in; absent when no points were paid. */
  epoch?: number;
  winners: Winner[];
  /** The Owner didn't pick in time. */
  expired?: true;
};

/** An entry as the server keeps it. */
export type StoredEntry = { post: string; userId: string; wallet: string; at: number };

/** Where a challenge stands now: before its end it is open; after, judged by the Owner or being settled. */
export type Phase = "open" | "judging" | "closing" | "settled" | "cancelled";

export function phaseOf(c: Pick<StoredChallenge, "state" | "endsAt" | "judging">, now: number): Phase {
  if (c.state !== "live") return c.state;
  if (now < c.endsAt) return "open";
  return c.judging === "owner" ? "judging" : "closing";
}

/** One entry as a reader sees it. */
export type PublicEntry = {
  post: string;
  wallet: string;
  at: number;
  /** Likes from other members; absent for a hidden post. */
  likes: number;
  /** The viewer liked it. */
  liked: boolean;
  mine: boolean;
  /** The text is read from the Board post; null when it's hidden from this reader. */
  text: string | null;
  place?: number;
};

export type PublicChallenge = {
  id: string;
  title: string;
  brief: string;
  judging: Judging;
  prizes: number[];
  startsAt: number;
  endsAt: number;
  by: string;
  phase: Phase;
  /** When an Owner-judged challenge expires if no pick is made. */
  pickBy?: number;
  entries: PublicEntry[];
  entryCount: number;
  settled?: Settlement;
  /** The viewer's own entry, if they entered. */
  mine?: string;
};

/** A member's challenge points counted in one epoch: capped, and the wins behind it. */
export type ChallengeAward = { userId: string; wallet: string; points: number; wins: { challenge: string; title: string; place: number; points: number }[] };

/** The points of `wins`, capped to what one member can count in an epoch. */
export const countedPoints = (points: number) => Math.min(CHALLENGE_CAP_PER_EPOCH, Math.max(0, points));

export type Candidate = { post: string; userId: string; wallet: string; at: number; likes: number };

/**
 * The winners of a challenge judged by likes (best first): entries with at least
 * `CHALLENGE_RULES.minLikes`, most liked first, the earlier entry first on a tie. Only `prizes.length`
 * places pay, and a member wins once.
 */
export function winnersByLikes(candidates: readonly Candidate[], prizes: readonly number[]): Winner[] {
  const ranked = candidates
    .filter((c) => c.likes >= CHALLENGE_RULES.minLikes)
    .sort((a, b) => b.likes - a.likes || a.at - b.at || (a.post < b.post ? -1 : a.post > b.post ? 1 : 0));
  const out: Winner[] = [];
  const seen = new Set<string>();
  for (const c of ranked) {
    if (out.length >= prizes.length) break;
    if (seen.has(c.userId)) continue;
    seen.add(c.userId);
    out.push({ post: c.post, wallet: c.wallet, place: out.length + 1, points: prizes[out.length]!, likes: c.likes });
  }
  return out;
}

/** The winners an Owner picked: `picked` post ids, best first, each an eligible entry, one per member, at most `prizes.length`. */
export function winnersByPick(picked: readonly string[], eligible: readonly Candidate[], prizes: readonly number[]): { ok: true; winners: Winner[] } | { ok: false; message: string } {
  if (picked.length < 1 || picked.length > prizes.length) return { ok: false, message: `Pick between 1 and ${prizes.length} entries.` };
  const byPost = new Map(eligible.map((c) => [c.post, c]));
  const seen = new Set<string>();
  const winners: Winner[] = [];
  for (const post of picked) {
    const c = byPost.get(post);
    if (!c) return { ok: false, message: "One of the picks isn’t an entry that can win." };
    if (seen.has(c.userId)) return { ok: false, message: "A member can win one place only." };
    seen.add(c.userId);
    winners.push({ post, wallet: c.wallet, place: winners.length + 1, points: prizes[winners.length]!, likes: c.likes });
  }
  return { ok: true, winners };
}

/** The prizes in words: "10, 5 and 2 points". */
export function prizeText(prizes: readonly number[]): string {
  if (prizes.length === 1) return `${prizes[0]} point${prizes[0] === 1 ? "" : "s"}`;
  return `${prizes.slice(0, -1).join(", ")} and ${prizes[prizes.length - 1]} points`;
}
