import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import type { ActivityEvent } from "./clubs";
import { REWARDS_EPOCH_SECONDS, REWARDS_GENESIS } from "./config";
import { MOMENTUM } from "./momentum";
import { strengthFactor, type SignalStrength } from "./xPosts";

/**
 * Club Rewards (ADR 0022, docs/09-clubs.md#rewards): each epoch, a share of the protocol fees a
 * Club's swaps paid goes back to the Club. Pure, so the builder, the routes, the screens and the
 * Guide share one set of numbers.
 */
/**
 * Rules no Club's Owner can change, because they cross Clubs or the contract fixes them: how the
 * fees are split, the bonus caps, and the base voice (ADR 0039).
 */
export const PROTOCOL = {
  /** Of the fees a Club's swaps paid, in basis points: to its Holders, by holdings and activity. */
  holderBps: 5_000,
  /** To the Club fund, which the Club's Owner claims. */
  fundBps: 2_500,
  /** What the protocol keeps. The three add up to 10,000. */
  protocolBps: 2_500,
  /**
   * The Holder bonus (ADR 0024): a Holder's shares count up to this much more (basis points) for
   * their activity in the Club during the epoch. Holding stays the base: a quiet Holder keeps theirs.
   */
  maxBonusBps: 5_000,
  /** At most this much streak bonus, on top of `maxBonusBps`. */
  maxStreakBps: 1_000,
  /**
   * The base voice (ADR 0039): every verified account (a shared X or Discord profile, linked at
   * least `verifiedDays` before the epoch ends) has this much a week, Holder or not, shared over the
   * likes and replies they gave in every Club. A Holder's NFT voice stays in their own Club.
   */
  baseVoice: 3,
  verifiedDays: 7,
  /** At most this many of a member's points an epoch come from base voices. */
  baseCapPerReceiver: 10,
  /** Points per counted X share (halved when it's only weakly about the Club): Momentum's weight. */
  xShareBase: MOMENTUM.xShareWeight,
  /** Points per doubling of an X share's engagement (likes + reposts + quotes + replies). */
  reachWeight: 2,
  /** At most this many reach points per member per Club per epoch, so a viral post can't take it all. */
  reachCapPerEpoch: 30,
} as const;

/**
 * The thresholds a Club's Owner may set (ADR 0040), as data so the scoring code reads them from the
 * Club and not from constants. `DEFAULT_CLUB_RULES` is what every Club uses until its Owner changes
 * them, and `rulesFor` (lib/server/clubRules.ts) is the only place they come from.
 */
export type ClubRules = {
  /** Every Holder with at least this many activity points is paid (ADR 0040). */
  minPoints: number;
  /** Activity points that earn the whole bonus. Most come from others' backing (ADR 0038, ADR 0039). */
  fullBonusPoints: number;
  /** Points per active day (ADR 0038): a UTC day with a visible post, a reply, or a like on another member's post in the Club. */
  dayPoints: number;
  /**
   * Backing (ADR 0038): each Holder's weekly voice is `voicePerNft` per NFT held (on average over
   * the week, ADR 0040), counting at most `voiceCapNfts`, shared over the likes and replies they gave
   * in the epoch. Unused voice is lost.
   */
  voicePerNft: number;
  voiceCapNfts: number;
  /** How a voice is shared: a like, a reply, and the first reply on a post from anyone but its author. */
  likeWeight: number;
  replyWeight: number;
  firstReplyWeight: number;
  /** Two members who backed each other in an epoch: each direction counts this much. */
  mutualFactor: number;
  /**
   * Points per completed swap with a counterparty who isn't the member's own wallet (ADR 0034). A
   * swap with a wallet the member already swapped with in the epoch within `MOMENTUM.washDays`
   * counts `MOMENTUM.washFactor` of it.
   */
  swapPoints: number;
  /** At most this many swap points per member per Club per epoch, so trading can't carry the bonus (7 full swaps). */
  swapCapPerEpoch: number;
  /** An epoch with at least this many active days keeps a member's streak going. */
  streakMinDays: number;
  /** The streak bonus (basis points) per qualifying epoch in a row after the first. */
  streakStepBps: number;
};

export const DEFAULT_CLUB_RULES: ClubRules = {
  minPoints: 10,
  fullBonusPoints: 35,
  dayPoints: 1,
  voicePerNft: 10,
  voiceCapNfts: 5,
  likeWeight: 1,
  replyWeight: 2,
  firstReplyWeight: 4,
  mutualFactor: 0.5,
  swapPoints: 2,
  swapCapPerEpoch: 14,
  streakMinDays: 3,
  streakStepBps: 250,
};

/** The range each rule may take when an Owner sets it: `[least, most]`. */
export const CLUB_RULE_BOUNDS: Record<keyof ClubRules, readonly [number, number]> = {
  minPoints: [1, 100],
  fullBonusPoints: [5, 200],
  dayPoints: [0, 5],
  voicePerNft: [1, 50],
  voiceCapNfts: [1, 20],
  likeWeight: [1, 10],
  replyWeight: [1, 10],
  firstReplyWeight: [1, 20],
  mutualFactor: [0, 1],
  swapPoints: [0, 10],
  swapCapPerEpoch: [0, 50],
  streakMinDays: [1, 7],
  streakStepBps: [0, 500],
};

/**
 * Club Rewards (ADR 0022, docs/09-clubs.md#rewards): each epoch, a share of the protocol fees a
 * Club's swaps paid goes back to the Club. Pure, so the builder, the routes, the screens and the
 * Guide share one set of numbers. `REWARDS` is the protocol rules with the default Club rules.
 */
export const REWARDS = { ...PROTOCOL, ...DEFAULT_CLUB_RULES } as const;

export const percent = (bps: number) => `${bps / 100}%`;

const DAY = 86_400;

// ─────────────────────────────────────────────────────────────── epochs

export type EpochWindow = { n: number; start: number; end: number };

/** The epoch `n`: `[start, end)` in unix seconds. */
export function epochWindow(n: number, genesis = REWARDS_GENESIS, length = REWARDS_EPOCH_SECONDS): EpochWindow {
  const start = genesis + n * length;
  return { n, start, end: start + length };
}

/** The epoch running at `now` (unix seconds); -1 before genesis. */
export function epochAt(now: number, genesis = REWARDS_GENESIS, length = REWARDS_EPOCH_SECONDS): number {
  return now < genesis ? -1 : Math.floor((now - genesis) / length);
}

// ─────────────────────────────────────────────────────────────── leaves

/**
 * The leaf `DeClubRewards.leaf(epoch, account, amount)` checks: hashed twice, and bound to the
 * chain and the contract so a proof can't be replayed against another deployment.
 */
export function rewardLeaf(chainId: number, contract: Address, epoch: number, account: Address, amount: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "address" }, { type: "uint256" }],
      [BigInt(chainId), contract, BigInt(epoch), account, amount],
    ),
  );
  return keccak256(inner);
}

// ─────────────────────────────────────────────────────────────── the Holder bonus

/** One counted X share's reach, read from the X API before the epoch is built (lib/server/xReach.ts). */
export type ReachEntry = {
  club: string;
  /** The member's Club wallet when they shared it. */
  wallet: string;
  /** Still their own post and still about the Club. A deleted post isn't. */
  ok: boolean;
  strength: SignalStrength | null;
  /** Likes + reposts + quotes + replies. */
  engagement: number;
  reason?: "deleted" | "not_author" | "no_signal" | "no_account";
};

/** Every counted X share's reach for an epoch, by X post id. Published with the epoch. */
export type ReachRecord = {
  n: number;
  /** Unix seconds. */
  collectedAt: number;
  /** False without X_BEARER_TOKEN: X shares then count their base points, with no reach. */
  available: boolean;
  posts: Record<string, ReachEntry>;
};

/**
 * Money a sponsor adds to one Club's Holder pool for one epoch (ADR 0035). The operator records it
 * before the epoch is built, from MON the sponsor sent to the operator; the epoch publishes it.
 */
export type Sponsorship = {
  club: string;
  /** Wei, a decimal string. */
  amount: string;
  /** Shown on the Rewards tab and in the recap. */
  sponsor: string;
  /** A project's own top-up, or someone else's. */
  kind: "owner" | "partner";
  /** Unix seconds it was recorded. */
  at: number;
  /** The wallet that paid, and its transaction, when the app checked the payment on chain (ADR 0036). */
  by?: string;
  tx?: string;
};

/** The longest sponsor name kept. */
export const SPONSOR_NAME_MAX = 40;

/** A Club's sponsors in one epoch, as published. */
export type PublishedSponsor = { sponsor: string; kind: Sponsorship["kind"]; amount: string; by?: string };

/** The least a sponsorship made in the app can be, in wei (0.1 MON): enough that a name isn't free. */
export const SPONSOR_MIN_WEI = 10n ** 17n;

/** What the sponsor signs to claim a payment as theirs, under a name (ADR 0036). Nobody else can put their name on it. */
export const sponsorMessage = (club: string, tx: string, name: string) =>
  `DeClub sponsorship\nClub: ${club.toLowerCase()}\nPayment: ${tx.toLowerCase()}\nName: ${name}`;

export type Activity = { x: number; days: number; swaps: number; backed: number; points: number; bonusBps: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A member's activity in a Club over an epoch: the backing others gave them (`backingPoints`,
 * ADR 0038), their active days, each worth `dayPoints`, their own X shares, each worth `xShareBase`
 * and its reach, and their completed swaps (`swapPoints`, ADR 0034). At most 7 active days count.
 * The reach read has the last word on an X share: one that was deleted, or edited so it's no longer
 * about the Club, counts for nothing.
 */
export function activityPoints(
  events: readonly ActivityEvent[],
  reach: ReachRecord | null,
  wallets: readonly string[],
  days = 0,
  backed = 0,
  rules: ClubRules = DEFAULT_CLUB_RULES,
): Activity {
  const own = new Set(wallets.map((w) => w.toLowerCase()));
  let base = 0;
  let reached = 0;
  for (const e of events) {
    if (e.kind !== "xshare" || !own.has(e.parties[0] ?? "")) continue;
    const read = reach?.available ? reach.posts[e.deal] : undefined;
    const factor = read ? (read.ok ? strengthFactor(read.strength) : 0) : (e.weight ?? 1);
    base += PROTOCOL.xShareBase * factor;
    if (read?.ok) reached += PROTOCOL.reachWeight * Math.log2(1 + read.engagement) * factor;
  }
  const x = base + Math.min(PROTOCOL.reachCapPerEpoch, reached);
  const swaps = swapActivity(events, own, rules);
  const active = Math.max(0, Math.min(7, Math.floor(days)));
  const support = Math.max(0, backed);
  const points = x + swaps + active * rules.dayPoints + support;
  return { x: round2(x), days: active, swaps: round2(swaps), backed: round2(support), points: round2(points), bonusBps: bonusBps(points, rules) };
}

/** One like or reply a member gave another in a Club's epoch (ADR 0038), by user id. */
export type BackingAction = { giver: string; receiver: string; kind: "like" | "reply" | "first" };

/** A Holder's weekly voice in their own Club: `voicePerNft` per NFT, counting at most `voiceCapNfts`. */
export const voiceOf = (shares: bigint | number, rules: ClubRules = DEFAULT_CLUB_RULES) =>
  rules.voicePerNft * Math.min(rules.voiceCapNfts, Math.max(0, Number(shares)));

/** What one like or reply weighs when a voice is shared out. */
export const backingWeight = (kind: BackingAction["kind"], rules: ClubRules = DEFAULT_CLUB_RULES) =>
  kind === "like" ? rules.likeWeight : kind === "reply" ? rules.replyWeight : rules.firstReplyWeight;

/**
 * A giver's voices for one Club (ADR 0039): `club`, their NFT voice there (`voiceOf`), shared over
 * what they gave in this Club; `base`, their base voice, shared over what they gave in every Club, of
 * which `given` is the total weight (this Club's when absent).
 */
export type Voice = { club: number; base: number; given?: number };

/**
 * What each member received from other members' voices (ADR 0038, ADR 0039). Each giver's NFT
 * voice is shared over what they gave in this Club, by weight; their base voice over what they gave
 * everywhere, so a like in one of twenty Clubs carries a twentieth of it. Actions on oneself carry
 * nothing; two members who both have a voice and backed each other get `mutualFactor` of it each
 * way; and at most `baseCapPerReceiver` of a member's points come from base voices. Gives, by user
 * id, the points, how many gave them any, and how much of it came from base voices.
 */
export function backingPoints(actions: readonly BackingAction[], voices: ReadonlyMap<string, Voice>, rules: ClubRules = DEFAULT_CLUB_RULES): Map<string, { points: number; backers: number; base: number }> {
  const given = actions.filter((a) => a.giver !== a.receiver);
  const has = (user: string) => {
    const v = voices.get(user);
    return !!v && (v.club > 0 || v.base > 0);
  };
  // Only backing that carries a voice makes a pair: a like back from someone with none trades nothing.
  const pairs = new Set(given.filter((a) => has(a.giver)).map((a) => `${a.giver}\n${a.receiver}`));
  const totals = new Map<string, number>();
  for (const a of given) totals.set(a.giver, (totals.get(a.giver) ?? 0) + backingWeight(a.kind, rules));
  const out = new Map<string, { club: number; base: number; backers: Set<string> }>();
  for (const a of given) {
    const voice = voices.get(a.giver);
    if (!voice || !has(a.giver)) continue;
    const part = (backingWeight(a.kind, rules) * (pairs.has(`${a.receiver}\n${a.giver}`) ? rules.mutualFactor : 1)) / totals.get(a.giver)!;
    // The base voice is shared over everything the giver gave, in every Club; never less than here.
    const everywhere = Math.max(voice.given ?? 0, totals.get(a.giver)!) / totals.get(a.giver)!;
    const entry = out.get(a.receiver) ?? { club: 0, base: 0, backers: new Set<string>() };
    entry.club += voice.club * part;
    entry.base += (voice.base * part) / everywhere;
    entry.backers.add(a.giver);
    out.set(a.receiver, entry);
  }
  return new Map(
    [...out].map(([user, { club, base, backers }]) => {
      const capped = Math.min(PROTOCOL.baseCapPerReceiver, base);
      return [user, { points: round2(club + capped), backers: backers.size, base: round2(capped) }];
    }),
  );
}

/**
 * A member's swap points in an epoch (ADR 0034). A swap counts when someone other than the member's
 * own wallets is on it, so swapping between one's own wallets earns nothing. Swapping again with a
 * counterparty within `MOMENTUM.washDays` counts `MOMENTUM.washFactor` of a swap, as in Momentum,
 * and the total is capped at `swapCapPerEpoch`.
 */
function swapActivity(events: readonly ActivityEvent[], own: ReadonlySet<string>, rules: ClubRules): number {
  const swaps = events.filter((e) => e.kind === "swapped" && e.parties.some((p) => own.has(p.toLowerCase()))).sort((a, b) => a.at - b.at);
  const lastWith = new Map<string, number>();
  let points = 0;
  for (const e of swaps) {
    const others = [...new Set(e.parties.map((p) => p.toLowerCase()))].filter((p) => !own.has(p));
    if (others.length === 0) continue;
    const repeat = others.some((o) => {
      const previous = lastWith.get(o);
      return previous !== undefined && e.at - previous <= MOMENTUM.washDays * DAY;
    });
    for (const o of others) lastWith.set(o, e.at);
    points += rules.swapPoints * (repeat ? MOMENTUM.washFactor : 1);
  }
  return Math.min(rules.swapCapPerEpoch, points);
}

/** The bonus for `points`, in basis points: linear up to `fullBonusPoints`, then capped. */
export const bonusBps = (points: number, rules: ClubRules = DEFAULT_CLUB_RULES) =>
  points <= 0 ? 0 : Math.floor(PROTOCOL.maxBonusBps * Math.min(1, points / rules.fullBonusPoints));

/**
 * The streak bonus for `streak` qualifying epochs in a row, this one included (ADR 0032): nothing
 * for the first, then `streakStepBps` more each epoch, up to `maxStreakBps`.
 */
export const streakBps = (streak: number, rules: ClubRules = DEFAULT_CLUB_RULES) =>
  streak <= 1 ? 0 : Math.min(PROTOCOL.maxStreakBps, rules.streakStepBps * (Math.floor(streak) - 1));

/** Whether an epoch with `days` active days keeps a streak going. */
export const qualifies = (days: number, rules: ClubRules = DEFAULT_CLUB_RULES) => days >= rules.streakMinDays;

/** One Club's inputs to an epoch. Amounts are wei. */
export type ClubInput = {
  /** The Club's own asset, lowercase. */
  club: string;
  /** Fees from this epoch's completed swaps that this Club gets to share, already split per Club. */
  fees: bigint;
  /** What earlier epochs couldn't pay out and roll in now. */
  carried: { holders: bigint; fund: bigint };
  /** Sponsors' money for this epoch (ADR 0035): all of it joins the Holder pool, none to the protocol. */
  sponsored?: bigint;
  /**
   * Each Holder member's display wallet, its shares and its bonus. Zero-share members are left out.
   * `joinedAt` (unix seconds) breaks a tie at the cutoff in favour of the earlier member.
   */
  holders: Holder[];
  /** Where the Club fund goes, or null with no Owner. */
  owner: string | null;
  /** The Club's rules for this epoch (ADR 0040). The defaults when absent. */
  rules?: ClubRules;
  /** How many daily holdings samples the epoch's `held` totals add up (ADR 0040), not counting the read at close. */
  samples?: number;
};

/**
 * One Holder member. `bonusBps` is the activity bonus and `streak` the qualifying epochs in a row;
 * `points` and `days` say how the bonus was earned.
 */
export type Holder = {
  wallet: string;
  /** NFTs held when the epoch was built: being paid needs at least one. */
  shares: bigint;
  /**
   * The NFTs held on every sampled day plus at close, added up (ADR 0040). Every Holder in a Club has
   * the same number of samples, so this is what the Holder pool is split by, in place of `shares`.
   */
  held?: bigint;
  bonusBps?: number;
  points?: number;
  days?: number;
  streak?: number;
  joinedAt?: number;
  /** Of `points`, from others' backing (ADR 0038). */
  backed?: number;
};

/** A holder payout also says how it was worked out: the shares held and the bonus they earned. */
export type Payout = {
  club: string;
  kind: "holder" | "fund";
  amount: bigint;
  shares?: bigint;
  /** The NFTs held on average over the epoch (ADR 0040), 2 decimals: what the share of the pool is worked out from. */
  held?: number;
  /** The whole bonus: activity plus streak. */
  bonusBps?: number;
  points?: number;
  days?: number;
  streak?: number;
  /** Of `points`, from others' backing: published, because likes aren't signed (ADR 0038). */
  backed?: number;
};

export type ClubSplit = {
  club: string;
  fees: bigint;
  sponsored: bigint;
  holderPool: bigint;
  fundPool: bigint;
  /** Paid this epoch, per kind. */
  paidHolders: bigint;
  paidFund: bigint;
  /** Rolls into the next epoch: no Holders or no Owner, plus rounding dust. */
  carry: { holders: bigint; fund: bigint };
  holderCount: number;
  /** The rules the split used, and how many holdings samples went into `held`. */
  rules: ClubRules;
  samples: number;
  payouts: (Payout & { wallet: string })[];
};

/** A Club's pools for an epoch: its share of the fees, whatever rolled in, and what sponsors added to the Holder pool. */
export function pools(fees: bigint, carried: { holders: bigint; fund: bigint }, sponsored = 0n) {
  return {
    holderPool: (fees * BigInt(PROTOCOL.holderBps)) / 10_000n + carried.holders + sponsored,
    fundPool: (fees * BigInt(PROTOCOL.fundBps)) / 10_000n + carried.fund,
  };
}

/**
 * Holders in the leaderboard order (ADR 0037): most activity points first, then the bigger holding,
 * the earlier member, the lower wallet, so a rebuild gives the same order. Zero-share members are
 * left out. A Holder below the floor is ranked but not paid: `paidPlaces` (ADR 0040).
 */
export function rankHolders<H extends Holder>(holders: readonly H[]): H[] {
  return holders
    .filter((h) => h.shares > 0n)
    .sort(
      (a, b) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        (a.shares === b.shares ? 0 : a.shares > b.shares ? -1 : 1) ||
        (a.joinedAt ?? 0) - (b.joinedAt ?? 0) ||
        (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1),
    );
}

/** The Holders the pool pays (ADR 0040): every one of those ranked with at least `rules.minPoints`. */
export function paidPlaces<H extends Holder>(ranked: readonly H[], rules: ClubRules = DEFAULT_CLUB_RULES): H[] {
  return ranked.filter((h) => (h.points ?? 0) >= rules.minPoints);
}

/**
 * How many more activity points `wallet` needs to be paid: 0 when it already is, null when it isn't
 * ranked at all (it holds nothing). The floor is a number, not a place, so what others do doesn't move it.
 */
export function entryGap(ranked: readonly Holder[], wallet: string, rules: ClubRules = DEFAULT_CLUB_RULES): number | null {
  const me = ranked.find((h) => h.wallet.toLowerCase() === wallet.toLowerCase());
  if (!me) return null;
  return Number(Math.max(0, rules.minPoints - (me.points ?? 0)).toFixed(2));
}

/** A Holder's whole bonus in basis points: activity (capped at `maxBonusBps`) plus streak. */
export function totalBonusBps(h: Pick<Holder, "bonusBps" | "streak">, rules: ClubRules = DEFAULT_CLUB_RULES): number {
  const activity = Math.min(PROTOCOL.maxBonusBps, Math.max(0, Math.floor(h.bonusBps ?? 0)));
  return activity + streakBps(h.streak ?? 0, rules);
}

/**
 * Splits one Club's pools between its Holders and its Owner. Every Holder with at least
 * `rules.minPoints` is paid (`paidPlaces`). Among them a Holder's weight is their NFTs, averaged over
 * the week (`held`, or `shares` when none was sampled), times (1 + bonus): holding is the base,
 * activity adds up to `maxBonusBps` and a streak up to `maxStreakBps`. Integer wei throughout;
 * rounding dust rolls into the next epoch.
 */
export function splitClub(input: ClubInput): ClubSplit {
  const rules = input.rules ?? DEFAULT_CLUB_RULES;
  const samples = input.samples ?? 0;
  const { holderPool, fundPool } = pools(input.fees, input.carried, input.sponsored ?? 0n);
  const holders = paidPlaces(rankHolders(input.holders), rules);
  const weightOf = (h: Holder) => (h.held ?? h.shares) * BigInt(10_000 + totalBonusBps(h, rules));
  const totalWeight = holders.reduce((sum, h) => sum + weightOf(h), 0n);
  const payouts: ClubSplit["payouts"] = [];

  let paidHolders = 0n;
  if (totalWeight > 0n) {
    for (const h of holders) {
      const amount = (holderPool * weightOf(h)) / totalWeight;
      if (amount === 0n) continue;
      payouts.push({
        club: input.club,
        kind: "holder",
        wallet: h.wallet.toLowerCase(),
        amount,
        shares: h.shares,
        ...(h.held !== undefined ? { held: averageHeld(h.held, samples) } : {}),
        bonusBps: totalBonusBps(h, rules),
        ...(h.points !== undefined ? { points: h.points } : {}),
        ...(h.days !== undefined ? { days: h.days } : {}),
        ...(h.streak !== undefined ? { streak: h.streak } : {}),
        ...(h.backed !== undefined ? { backed: h.backed } : {}),
      });
      paidHolders += amount;
    }
  }
  const paidFund = input.owner && fundPool > 0n ? fundPool : 0n;
  if (paidFund > 0n) payouts.push({ club: input.club, kind: "fund", wallet: input.owner!.toLowerCase(), amount: paidFund });

  return {
    club: input.club,
    fees: input.fees,
    sponsored: input.sponsored ?? 0n,
    holderPool,
    fundPool,
    paidHolders,
    paidFund,
    carry: { holders: holderPool - paidHolders, fund: fundPool - paidFund },
    holderCount: holders.length,
    rules,
    samples,
    payouts,
  };
}

/** The NFTs held on average (ADR 0040): `held` adds up `samples` daily reads and the one at close. */
export const averageHeld = (held: bigint, samples: number) => round2(Number(held) / (samples + 1));

/** One account's leaf: everything it earned this epoch, across Clubs, with the breakdown. */
export type Leaf = { account: Address; amount: bigint; breakdown: Payout[] };

/** Sums every Club's payouts per wallet, ordered by address so a rebuild gives the same tree. */
export function leavesOf(splits: readonly ClubSplit[]): Leaf[] {
  const byWallet = new Map<string, Leaf>();
  for (const split of splits) {
    for (const p of split.payouts) {
      const leaf = byWallet.get(p.wallet) ?? { account: getAddress(p.wallet), amount: 0n, breakdown: [] };
      leaf.amount += p.amount;
      const { club, kind, amount, shares, held, points, days, streak, backed } = p;
      leaf.breakdown.push({
        club,
        kind,
        amount,
        ...(shares !== undefined ? { shares, bonusBps: p.bonusBps } : {}),
        ...(held !== undefined ? { held } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(days !== undefined ? { days } : {}),
        ...(streak !== undefined ? { streak } : {}),
        ...(backed !== undefined ? { backed } : {}),
      });
      byWallet.set(p.wallet, leaf);
    }
  }
  return [...byWallet.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, leaf]) => leaf);
}

// ─────────────────────────────────────────────────────────────── what the API serves

/** An epoch as stored and published. Amounts are decimal strings so it round-trips as JSON. */
export type EpochRecord = {
  n: number;
  chainId: number;
  contract: Address;
  start: number;
  end: number;
  /** Unix seconds the builder ran (and read Holder balances). */
  builtAt: number;
  root: Hex;
  total: string;
  clubs: {
    club: string;
    fees: string;
    /** What sponsors added to the Holder pool (ADR 0035); absent in epochs built before. */
    sponsored?: string;
    sponsors?: PublishedSponsor[];
    holderPool: string;
    fundPool: string;
    paidHolders: string;
    paidFund: string;
    carry: { holders: string; fund: string };
    holderCount: number;
    /** The rules this Club's epoch was worked out with (ADR 0040); absent in epochs built before. */
    rules?: ClubRules;
    /** How many daily holdings samples the average NFTs (`held`) are over, plus the read at close. */
    samples?: number;
    /** Unix seconds this Club's inputs were frozen (ADR 0040): later likes taken back, deletes and hides don't count. */
    closedAt?: number;
  }[];
  leaves: { account: Address; amount: string; proof: Hex[]; breakdown: PublishedPayout[] }[];
  /** The X reach the Holder bonus used (ADR 0024), or null when none was read. */
  reach?: ReachRecord | null;
};

/** A payout as published: amounts as decimal strings. */
export type PublishedPayout = { club: string; kind: Payout["kind"]; amount: string; shares?: string; held?: number; bonusBps?: number; points?: number; days?: number; streak?: number; backed?: number };

/** A claimable leaf as `/api/rewards/me` serves it. */
export type ClaimableLeaf = {
  epoch: number;
  account: Address;
  amount: string;
  proof: Hex[];
  breakdown: PublishedPayout[];
};
