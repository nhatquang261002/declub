/**
 * Momentum (ADR 0016, docs/09-clubs.md): how busy a Club's market has been, and how much each
 * wallet added. Pure functions over the Club's activity log, so the rules are tested without a
 * server and tuned in one place.
 */
export const MOMENTUM = {
  /** An event's weight halves every this many days. */
  halfLifeDays: 7,
  /** Older events are ignored. */
  windowDays: 30,
  /** Each wallet in a completed swap earns this. A swap is paid for twice (ADR 0015). */
  swapWeight: 10,
  /** A new deal, open offer or intent. Cheap to make, so it's capped below. */
  createdWeight: 2,
  /** Counted at most this many times per wallet per UTC day. */
  createdPerDay: 3,
  /** A swap between wallets that already swapped within `washDays` earns this fraction. */
  washFactor: 0.5,
  washDays: 7,
  /** Club score = sum × (1 + log2(wallets)) / this. Breadth counts. */
  breadthDivisor: 4,
  /**
   * A Holder's own X post about the Club, shared on its Board (ADR 0024): one a day per member, so
   * it can't outweigh trading. A post that is only weakly about the Club counts half.
   */
  xShareWeight: 3,
  /**
   * A Holder's Board post (ADR 0047): the first a day per member per Club, a little above an X
   * share. Hidden and deleted posts count for nothing.
   */
  postWeight: 4,
} as const;

export type ActivityKind = "created" | "swapped" | "xshare" | "post";

/** What the score needs from a logged event. The log keeps more (see lib/server/activity.ts). */
export type ScoredEvent = {
  kind: ActivityKind;
  /** Unix seconds. */
  at: number;
  /** Lowercase wallet addresses. A swap has the two sides; a creation has the maker; an X share or a Board post the member. */
  parties: string[];
  /** An X share's strength factor (1 strong, 0.5 weak). Other kinds ignore it. */
  weight?: number;
};

export type Scores = {
  /** Club Momentum. */
  club: number;
  /** Per wallet (lowercase address). */
  wallets: Map<string, number>;
  /** Distinct wallets in the window. */
  uniqueWallets: number;
};

const DAY = 86_400;
const round = (n: number) => Math.round(n * 100) / 100;

const decayOf = (ageSec: number) => 0.5 ** (ageSec / (MOMENTUM.halfLifeDays * DAY));

/** The unordered pair, as one key. */
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Scores `events` as of `now` (unix seconds). Events after `now` are ignored. `decay: false` counts
 * every event in full, as an epoch's activity does (lib/rewards.ts).
 */
export function score(events: ScoredEvent[], now: number, options: { decay?: boolean; windowSec?: number } = {}): Scores {
  const since = now - (options.windowSec ?? MOMENTUM.windowDays * DAY);
  const decay = options.decay === false ? () => 1 : decayOf;
  const live = events.filter((e) => e.at > since && e.at <= now).sort((a, b) => a.at - b.at);

  const wallets = new Map<string, number>();
  const seen = new Set<string>();
  const add = (wallet: string, amount: number) => wallets.set(wallet, (wallets.get(wallet) ?? 0) + amount);

  const createdToday = new Map<string, number>();
  const lastSwap = new Map<string, number>();

  for (const e of live) {
    const parties = [...new Set(e.parties.map((p) => p.toLowerCase()))];
    const weight = decay(now - e.at);

    // An X share or a Board post is attention, not trading: it scores its member and leaves breadth
    // (how many wallets traded) alone. The once-a-day rules are applied when it's recorded and read.
    if (e.kind === "xshare" || e.kind === "post") {
      const wallet = parties[0];
      const base = e.kind === "xshare" ? MOMENTUM.xShareWeight * (e.weight ?? 1) : MOMENTUM.postWeight;
      if (wallet) add(wallet, base * weight);
      continue;
    }

    if (e.kind === "created") {
      for (const wallet of parties) {
        const day = `${wallet}:${Math.floor(e.at / DAY)}`;
        const n = createdToday.get(day) ?? 0;
        createdToday.set(day, n + 1);
        seen.add(wallet);
        if (n < MOMENTUM.createdPerDay) add(wallet, MOMENTUM.createdWeight * weight);
      }
      continue;
    }

    // A swap needs two different wallets: filling your own deal moves nothing.
    if (parties.length < 2) continue;
    // A ring has more than two sides: it's a repeat if any two of them swapped recently.
    let repeat = false;
    for (let i = 0; i < parties.length; i++) {
      for (let j = i + 1; j < parties.length; j++) {
        const key = pairKey(parties[i]!, parties[j]!);
        const previous = lastSwap.get(key);
        if (previous !== undefined && e.at - previous <= MOMENTUM.washDays * DAY) repeat = true;
        lastSwap.set(key, e.at);
      }
    }
    const wash = repeat ? MOMENTUM.washFactor : 1;
    for (const wallet of parties) {
      seen.add(wallet);
      add(wallet, MOMENTUM.swapWeight * weight * wash);
    }
  }

  const sum = [...wallets.values()].reduce((a, b) => a + b, 0);
  const breadth = seen.size === 0 ? 0 : (1 + Math.log2(seen.size)) / MOMENTUM.breadthDivisor;
  return {
    club: round(sum * breadth),
    wallets: new Map([...wallets].map(([wallet, value]) => [wallet, round(value)])),
    uniqueWallets: seen.size,
  };
}

type Trend = { score: number; previous: number; change: number };

/** Club Momentum now, a week ago, and the difference. */
export function trend(events: ScoredEvent[], now: number): Trend {
  const current = score(events, now).club;
  const previous = score(events, now - MOMENTUM.halfLifeDays * DAY).club;
  return { score: current, previous, change: round(current - previous) };
}

/** A member's Momentum: the sum over the wallets they've linked. */
export function memberScore(scores: Scores, wallets: string[]): number {
  const own = new Set(wallets.map((w) => w.toLowerCase()));
  let total = 0;
  for (const [wallet, value] of scores.wallets) if (own.has(wallet)) total += value;
  return round(total);
}
