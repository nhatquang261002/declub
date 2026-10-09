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
   * their activity in the Club during the epoch. Holding stays the base. Lowered from 50% to 25%
   * (ADR 0044): the bonus is the one part of a payout that accounts alone can farm.
   */
  maxBonusBps: 2_500,
  /** Nobody is paid with fewer activity points than this, whatever their Club's rules (ADR 0044). */
  minPaidPoints: 1,
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
 * Every rule an epoch is scored and paid by, as data so the scoring code reads them from the epoch
 * and not from constants (ADR 0040), and each epoch publishes the ones it used. Only the paying rules
 * (`OWNER_RULES`: who is paid and how much of their share) are the Owner's to change (ADR 0044); how
 * points are counted is the same in every Club. `rulesFor` (lib/server/clubRules.ts) is the only
 * place a Club's rules come from.
 */
export type ClubRules = {
  /**
   * The ramp (ADR 0044): a Holder's weight counts `min(1, points / rampPoints)` of their NFTs, so a
   * Holder with half these points gets half their share and one with more gets all of it. Anyone with
   * at least `PROTOCOL.minPaidPoints` is paid something; there is no cliff to game.
   */
  rampPoints: number;
  /** Pay at most this many Holders, the most active first; 0 is no limit (ADR 0044). */
  maxPaid: number;
  /** Pay at most this percentage of the Club's Holders (rounded up, at least one), the most active first; 100 is no limit. */
  maxPaidPercent: number;
  /**
   * The slice of the Holder pool (basis points) for members without NFTs, split by their points
   * (ADR 0044). 0 is off. Holders share the rest by NFTs, as always, so the most an account farm with
   * no NFTs can take is this slice.
   */
  nonHolderBps: number;
  /** At most this many points one member can give another in an epoch, NFT and base voice together (ADR 0044). The same in every Club. */
  pairCap: number;
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
  /**
   * Engaging (ADR 0046): what a member earns themselves for engaging with others, per other member
   * (not per action): `engageReplyPoints` for each they replied to, `engageLikePoints` for each they
   * only liked, at most `engageCapPerEpoch` an epoch.
   */
  engageReplyPoints: number;
  engageLikePoints: number;
  engageCapPerEpoch: number;
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
  rampPoints: 5,
  maxPaid: 0,
  maxPaidPercent: 100,
  nonHolderBps: 0,
  pairCap: 20,
  fullBonusPoints: 35,
  dayPoints: 1,
  voicePerNft: 10,
  voiceCapNfts: 5,
  likeWeight: 1,
  replyWeight: 2,
  firstReplyWeight: 4,
  engageReplyPoints: 1,
  engageLikePoints: 0.5,
  engageCapPerEpoch: 5,
  mutualFactor: 0.5,
  swapPoints: 2,
  swapCapPerEpoch: 14,
  streakMinDays: 3,
  streakStepBps: 250,
};

/**
 * The rules a Club's Owner may set (ADR 0044): who is paid and how much of their share. How points are
 * counted (voice, weights, days, swaps, streaks, the pair cap, the bonus curve) is the same in every
 * Club, so a Club's points mean the same as another's and an Owner can't tune them toward themselves.
 */
export const OWNER_RULES = ["rampPoints", "maxPaid", "maxPaidPercent", "nonHolderBps"] as const;
export type OwnerRule = (typeof OWNER_RULES)[number];
export type OwnerRules = Pick<ClubRules, OwnerRule>;

/** The range each Owner rule may take: `[least, most]`. */
export const CLUB_RULE_BOUNDS: Record<OwnerRule, readonly [number, number]> = {
  rampPoints: [1, 100],
  maxPaid: [0, 1_000],
  maxPaidPercent: [1, 100],
  nonHolderBps: [0, 3_000],
};

/** The Owner rules that take whole numbers only. */
export const WHOLE_RULES: ReadonlySet<OwnerRule> = new Set<OwnerRule>(["maxPaid", "maxPaidPercent", "nonHolderBps"]);

const isOwnerRule = (key: string): key is OwnerRule => (OWNER_RULES as readonly string[]).includes(key);

/** Only the Owner's rules out of `saved`, over the defaults: anything else a save holds is ignored. */
export function ownerRulesOf(saved: Partial<ClubRules> | undefined): ClubRules {
  const rules: ClubRules = { ...DEFAULT_CLUB_RULES };
  for (const key of OWNER_RULES) if (typeof saved?.[key] === "number") rules[key] = saved[key];
  return rules;
}

/**
 * Checks rules an Owner sent (ADR 0044): every key must be an Owner rule, a finite number inside its
 * bounds, and whole where the rule counts something. Rules not sent keep `base`'s value.
 */
export function checkRules(input: unknown, base: ClubRules = DEFAULT_CLUB_RULES): { ok: true; rules: ClubRules } | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, message: "Send the rules as an object." };
  const rules: ClubRules = { ...base };
  for (const [key, value] of Object.entries(input)) {
    if (!isOwnerRule(key)) return { ok: false, message: `${key} isn't a rule an Owner can set.` };
    const [least, most] = CLUB_RULE_BOUNDS[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, message: `${key} must be a number.` };
    if (value < least || value > most) return { ok: false, message: `${key} must be between ${least} and ${most}.` };
    if (WHOLE_RULES.has(key) && !Number.isInteger(value)) return { ok: false, message: `${key} must be a whole number.` };
    rules[key] = value;
  }
  return { ok: true, rules };
}

/**
 * Club Rewards (ADR 0022, docs/09-clubs.md#rewards): each epoch, a share of the protocol fees a
 * Club's swaps paid goes back to the Club. Pure, so the builder, the routes, the screens and the
 * Guide share one set of numbers. `REWARDS` is the protocol rules with the default Club rules.
 */
export const REWARDS = { ...PROTOCOL, ...DEFAULT_CLUB_RULES } as const;

export const percent = (bps: number) => `${bps / 100}%`;

const DAY = 86_400;

// ─────────────────────────────────────────────────────────────── epochs

type EpochWindow = { n: number; start: number; end: number };

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
  /** The sponsor's signature of `sponsorMessage`, kept with the payment so the ledger can be rebuilt from the chain (ADR 0053). */
  signature?: string;
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

type Activity = {
  x: number;
  days: number;
  swaps: number;
  backed: number;
  /** Won in challenges (ADR 0045); absent when none. */
  challenge?: number;
  /** Earned for engaging with other members (ADR 0046), already capped; absent when none. */
  engaged?: number;
  points: number;
  bonusBps: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A member's activity in a Club over an epoch: the backing others gave them (`backingPoints`,
 * ADR 0038), their active days, each worth `dayPoints`, their own X shares, each worth `xShareBase`
 * and its reach, and their completed swaps (`swapPoints`, ADR 0034). At most 7 active days count.
 * The reach read has the last word on an X share: one that was deleted, or edited so it's no longer
 * about the Club, counts for nothing. `challenge` is what the member won in the Club's challenges
 * this epoch (ADR 0045), and `engaged` what they earned for engaging with others (`engagementPoints`,
 * ADR 0046), both already capped.
 */
export function activityPoints(
  events: readonly ActivityEvent[],
  reach: ReachRecord | null,
  wallets: readonly string[],
  days = 0,
  backed = 0,
  rules: ClubRules = DEFAULT_CLUB_RULES,
  challenge = 0,
  engaged = 0,
): Activity {
  const own = new Set(wallets.map((w) => w.toLowerCase()));
  let base = 0;
  let reached = 0;
  for (const e of events) {
    // An X share that is a challenge entry counts toward Momentum only (ADR 0048).
    if (e.kind !== "xshare" || e.entry || !own.has(e.parties[0] ?? "")) continue;
    const read = reach?.available ? reach.posts[e.deal] : undefined;
    const factor = read ? (read.ok ? strengthFactor(read.strength) : 0) : (e.weight ?? 1);
    base += PROTOCOL.xShareBase * factor;
    if (read?.ok) reached += PROTOCOL.reachWeight * Math.log2(1 + read.engagement) * factor;
  }
  const x = base + Math.min(PROTOCOL.reachCapPerEpoch, reached);
  const swaps = swapActivity(events, own, rules);
  const active = Math.max(0, Math.min(7, Math.floor(days)));
  const support = Math.max(0, backed);
  const won = Math.max(0, challenge);
  const engaging = Math.max(0, Math.min(rules.engageCapPerEpoch, engaged));
  const points = x + swaps + active * rules.dayPoints + support + won + engaging;
  return {
    x: round2(x),
    days: active,
    swaps: round2(swaps),
    backed: round2(support),
    ...(won > 0 ? { challenge: round2(won) } : {}),
    ...(engaging > 0 ? { engaged: round2(engaging) } : {}),
    points: round2(points),
    bonusBps: bonusBps(points, rules),
  };
}

/** One like or reply a member gave another in a Club's epoch (ADR 0038), by user id. */
/**
 * One like or reply. `entry` marks one given to a challenge entry (ADR 0048): the challenge's prize
 * covers the entry, so it backs nobody, but the giver still earns for engaging (`engagementPoints`).
 */
export type BackingAction = { giver: string; receiver: string; kind: "like" | "reply" | "first"; entry?: true };

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
 * way; one member gives another at most `pairCap` in an epoch (ADR 0044); and at most
 * `baseCapPerReceiver` of a member's points come from base voices. Gives, by user id, the points,
 * how many gave them any, and how much of it came from base voices.
 */
export function backingPoints(
  actions: readonly BackingAction[],
  voices: ReadonlyMap<string, Voice>,
  rules: ClubRules = DEFAULT_CLUB_RULES,
): Map<string, { points: number; backers: number; base: number }> {
  // A challenge entry earns through its challenge (ADR 0048): backing given to one doesn't count, nor use the giver's voice.
  const given = actions.filter((a) => a.giver !== a.receiver && !a.entry);
  const has = (user: string) => {
    const v = voices.get(user);
    return !!v && (v.club > 0 || v.base > 0);
  };
  // Only backing that carries a voice makes a pair: a like back from someone with none trades nothing.
  const pairs = new Set(given.filter((a) => has(a.giver)).map((a) => `${a.giver}\n${a.receiver}`));
  const totals = new Map<string, number>();
  for (const a of given) totals.set(a.giver, (totals.get(a.giver) ?? 0) + backingWeight(a.kind, rules));
  // What each giver gave each receiver, before the pair cap.
  const byPair = new Map<string, { giver: string; receiver: string; club: number; base: number }>();
  for (const a of given) {
    const voice = voices.get(a.giver);
    if (!voice || !has(a.giver)) continue;
    const part = (backingWeight(a.kind, rules) * (pairs.has(`${a.receiver}\n${a.giver}`) ? rules.mutualFactor : 1)) / totals.get(a.giver)!;
    // The base voice is shared over everything the giver gave, in every Club; never less than here.
    const everywhere = Math.max(voice.given ?? 0, totals.get(a.giver)!) / totals.get(a.giver)!;
    const key = `${a.giver}\n${a.receiver}`;
    const entry = byPair.get(key) ?? { giver: a.giver, receiver: a.receiver, club: 0, base: 0 };
    entry.club += voice.club * part;
    entry.base += (voice.base * part) / everywhere;
    byPair.set(key, entry);
  }
  const out = new Map<string, { club: number; base: number; backers: Set<string> }>();
  for (const { giver, receiver, club, base } of byPair.values()) {
    // Over the cap, both voices are scaled down together.
    const scale = club + base > rules.pairCap ? rules.pairCap / (club + base) : 1;
    const entry = out.get(receiver) ?? { club: 0, base: 0, backers: new Set<string>() };
    entry.club += club * scale;
    entry.base += base * scale;
    entry.backers.add(giver);
    out.set(receiver, entry);
  }
  return new Map(
    [...out].map(([user, { club, base, backers }]) => {
      const capped = Math.min(PROTOCOL.baseCapPerReceiver, base);
      return [user, { points: round2(club + capped), backers: backers.size, base: round2(capped) }];
    }),
  );
}

/**
 * What each member earns for engaging with others in a Club over an epoch (ADR 0046), by user id:
 * `engageReplyPoints` for each other member they replied to, `engageLikePoints` for each they only
 * liked, at most `engageCapPerEpoch`. It counts members, not actions, so engaging with many members
 * pays and fifty likes on one member's posts earn what one does. Unlike backing, it needs no voice:
 * members without NFTs earn it too. Actions on oneself count for nothing.
 */
export function engagementPoints(actions: readonly BackingAction[], rules: ClubRules = DEFAULT_CLUB_RULES): Map<string, number> {
  const byGiver = new Map<string, Map<string, number>>();
  for (const a of actions) {
    if (a.giver === a.receiver) continue;
    const worth = a.kind === "like" ? rules.engageLikePoints : rules.engageReplyPoints;
    const mine = byGiver.get(a.giver) ?? new Map<string, number>();
    mine.set(a.receiver, Math.max(mine.get(a.receiver) ?? 0, worth));
    byGiver.set(a.giver, mine);
  }
  return new Map(
    [...byGiver].map(([giver, mine]) => [
      giver,
      round2(
        Math.min(
          rules.engageCapPerEpoch,
          [...mine.values()].reduce((sum, p) => sum + p, 0),
        ),
      ),
    ]),
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
  /**
   * Members without NFTs, with their points (ADR 0044): they share `rules.nonHolderBps` of the Holder
   * pool by points. Left out unless the Club pays non-Holders.
   */
  members?: Holder[];
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
type Payout = {
  club: string;
  /** A Holder's share, a member without NFTs' share (ADR 0044), or the Owner's Club fund. */
  kind: "holder" | "member" | "fund";
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

type ClubSplit = {
  club: string;
  fees: bigint;
  sponsored: bigint;
  holderPool: bigint;
  fundPool: bigint;
  /** Paid this epoch, per kind: Holders, members without NFTs (ADR 0044), and the fund. */
  paidHolders: bigint;
  paidMembers: bigint;
  paidFund: bigint;
  /** Rolls into the next epoch: no Holders or no Owner, plus rounding dust. */
  carry: { holders: bigint; fund: bigint };
  holderCount: number;
  memberCount: number;
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
 * left out. Who of them is paid is `paidPlaces`.
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

/** Members without NFTs in the order their slice reads them (ADR 0044): most points first, then the earlier member, the lower wallet. */
export function rankMembers<H extends Holder>(members: readonly H[]): H[] {
  return members
    .filter((m) => m.shares === 0n)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1));
}

/**
 * How many Holders can be paid, of `holders` ranked (ADR 0044): `maxPaid` if set, and
 * `maxPaidPercent` of them rounded up, whichever is fewer, but at least one.
 */
export function seatsFor(holders: number, rules: ClubRules = DEFAULT_CLUB_RULES): number {
  if (holders <= 0) return 0;
  const byPercent = Math.max(1, Math.ceil((holders * rules.maxPaidPercent) / 100));
  return Math.min(byPercent, rules.maxPaid > 0 ? rules.maxPaid : Infinity);
}

/**
 * The Holders the pool pays (ADR 0044): those ranked with at least `PROTOCOL.minPaidPoints`, the most
 * active first, as many as the Club's seats allow (all of them unless the Owner set a limit).
 */
export function paidPlaces<H extends Holder>(ranked: readonly H[], rules: ClubRules = DEFAULT_CLUB_RULES): H[] {
  return ranked.filter((h) => (h.points ?? 0) >= PROTOCOL.minPaidPoints).slice(0, seatsFor(ranked.length, rules));
}

/** How much of their NFTs a Holder with `points` is paid for (ADR 0044), in basis points: the ramp to `rampPoints`. */
export const rampBps = (points: number, rules: ClubRules = DEFAULT_CLUB_RULES) =>
  points < PROTOCOL.minPaidPoints ? 0 : Math.floor(10_000 * Math.min(1, points / rules.rampPoints));

/**
 * How many more activity points `wallet` needs to be paid at all: 0 when it already is, null when it
 * isn't ranked (it holds nothing). Without a seat limit it is only the minimum; with one, the points
 * to pass the last paid Holder, with the tie rule.
 */
export function entryGap(ranked: readonly Holder[], wallet: string, rules: ClubRules = DEFAULT_CLUB_RULES): number | null {
  const me = ranked.find((h) => h.wallet.toLowerCase() === wallet.toLowerCase());
  if (!me) return null;
  const paid = paidPlaces(ranked, rules);
  if (paid.includes(me)) return 0;
  const toMinimum = Math.max(0, PROTOCOL.minPaidPoints - (me.points ?? 0));
  if (paid.length < seatsFor(ranked.length, rules)) return Number(toMinimum.toFixed(2));
  const last = paid[paid.length - 1]!;
  const winsTie = rankHolders([{ ...me, points: last.points }, last])[0] !== last;
  return Number(Math.max(toMinimum, Math.max(0, (last.points ?? 0) - (me.points ?? 0)) + (winsTie ? 0 : 0.01)).toFixed(2));
}

/** Who a Club's rules pay, in words: "every active Holder", "the 10 most active Holders", "the most active 20% of Holders". */
export function whoIsPaid(rules: ClubRules = DEFAULT_CLUB_RULES): string {
  const top = rules.maxPaid > 0 ? `the ${rules.maxPaid} most active Holders` : null;
  const share = rules.maxPaidPercent < 100 ? `the most active ${rules.maxPaidPercent}% of Holders` : null;
  if (top && share) return `${share}, at most ${rules.maxPaid}`;
  return top ?? share ?? "every active Holder";
}

/** How many more points get a Holder's whole share (ADR 0044): the rest of the ramp. */
export const rampGap = (points: number, rules: ClubRules = DEFAULT_CLUB_RULES) => Number(Math.max(0, rules.rampPoints - points).toFixed(2));

/** A Holder's whole bonus in basis points: activity (capped at `maxBonusBps`) plus streak. */
export function totalBonusBps(h: Pick<Holder, "bonusBps" | "streak">, rules: ClubRules = DEFAULT_CLUB_RULES): number {
  const activity = Math.min(PROTOCOL.maxBonusBps, Math.max(0, Math.floor(h.bonusBps ?? 0)));
  return activity + streakBps(h.streak ?? 0, rules);
}

/** What a member without NFTs weighs in their slice (ADR 0044): their points, counting at most `fullBonusPoints`, in hundredths. */
const memberWeight = (m: Holder, rules: ClubRules) => BigInt(Math.round(Math.min(m.points ?? 0, rules.fullBonusPoints) * 100));

/**
 * Splits one Club's pools between its Holders, its members without NFTs and its Owner (ADR 0044).
 *
 * - **Holders:** those `paidPlaces` picks. A Holder's weight is their NFTs, averaged over the week
 *   (`held`, or `shares` when none was sampled), times (1 + bonus), times the ramp
 *   (`min(1, points / rampPoints)`): holding is the base, activity adds up to `maxBonusBps` and a
 *   streak up to `maxStreakBps`.
 * - **Members without NFTs:** when the Club pays them (`nonHolderBps`) and any have points, they
 *   share that slice of the Holder pool by points; otherwise it stays with the Holders.
 * - **The fund** goes to the Owner.
 *
 * Integer wei throughout; what isn't paid, and rounding dust, rolls into the next epoch.
 */
export function splitClub(input: ClubInput): ClubSplit {
  const rules = input.rules ?? DEFAULT_CLUB_RULES;
  const samples = input.samples ?? 0;
  const { holderPool, fundPool } = pools(input.fees, input.carried, input.sponsored ?? 0n);
  const holders = paidPlaces(rankHolders(input.holders), rules);
  const members = rankMembers(input.members ?? []).filter((m) => (m.points ?? 0) >= PROTOCOL.minPaidPoints);
  const memberPool = rules.nonHolderBps > 0 && members.length > 0 ? (holderPool * BigInt(rules.nonHolderBps)) / 10_000n : 0n;
  const holdersPart = holderPool - memberPool;
  const weightOf = (h: Holder) => (h.held ?? h.shares) * BigInt(10_000 + totalBonusBps(h, rules)) * BigInt(rampBps(h.points ?? 0, rules));
  const totalWeight = holders.reduce((sum, h) => sum + weightOf(h), 0n);
  const payouts: ClubSplit["payouts"] = [];

  let paidHolders = 0n;
  if (totalWeight > 0n) {
    for (const h of holders) {
      const amount = (holdersPart * weightOf(h)) / totalWeight;
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

  let paidMembers = 0n;
  const memberTotal = members.reduce((sum, m) => sum + memberWeight(m, rules), 0n);
  if (memberPool > 0n && memberTotal > 0n) {
    for (const m of members) {
      const amount = (memberPool * memberWeight(m, rules)) / memberTotal;
      if (amount === 0n) continue;
      payouts.push({
        club: input.club,
        kind: "member",
        wallet: m.wallet.toLowerCase(),
        amount,
        ...(m.points !== undefined ? { points: m.points } : {}),
        ...(m.days !== undefined ? { days: m.days } : {}),
        ...(m.backed !== undefined ? { backed: m.backed } : {}),
      });
      paidMembers += amount;
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
    paidMembers,
    paidFund,
    carry: { holders: holderPool - paidHolders - paidMembers, fund: fundPool - paidFund },
    holderCount: holders.length,
    memberCount: payouts.filter((p) => p.kind === "member").length,
    rules,
    samples,
    payouts,
  };
}

/** The NFTs held on average (ADR 0040): `held` adds up `samples` daily reads and the one at close. */
export const averageHeld = (held: bigint, samples: number) => round2(Number(held) / (samples + 1));

/** One account's leaf: everything it earned this epoch, across Clubs, with the breakdown. */
type Leaf = { account: Address; amount: bigint; breakdown: Payout[] };

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
    /** Of `fees`, what signed swaps paid in WMON, unwrapped to MON before the epoch is funded; absent when none. */
    signedFees?: string;
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
    /** Paid to members without NFTs (ADR 0044), and how many; absent when the Club doesn't pay them. */
    paidMembers?: string;
    memberCount?: number;
    /** Wallets the Owner banned from rewards this epoch (ADR 0044): not paid, and their backing gave nothing. */
    excluded?: string[];
  }[];
  leaves: { account: Address; amount: string; proof: Hex[]; breakdown: PublishedPayout[] }[];
  /** The X reach the Holder bonus used (ADR 0024), or null when none was read. */
  reach?: ReachRecord | null;
};

/** A payout as published: amounts as decimal strings. */
export type PublishedPayout = {
  club: string;
  kind: Payout["kind"];
  amount: string;
  shares?: string;
  held?: number;
  bonusBps?: number;
  points?: number;
  days?: number;
  streak?: number;
  backed?: number;
};

/** A claimable leaf as `/api/rewards/me` serves it. */
export type ClaimableLeaf = {
  epoch: number;
  account: Address;
  amount: string;
  proof: Hex[];
  breakdown: PublishedPayout[];
};
