import { concat, formatUnits, hexToBigInt, isAddress, keccak256, numberToHex, parseUnits, stringToHex, type Hex } from "viem";
import { cleanLine, type StoredPost, type StoredXCard } from "./clubPosts";
import { registry as defaultRegistry, type Registry } from "./verifiedAssets";

/**
 * Club challenges (ADR 0045, docs/09-clubs.md#challenges): the Owner sets the Club a task at any
 * time, members answer it with a Board post, and the winners earn activity points for the epoch the
 * challenge ends in. Pure, so the server, the screens and the tests share one set of rules. The
 * points are the Owner's to set, within bounds, and they count like any other activity points
 * (`activityPoints`, lib/rewards.ts): they raise the bonus and the ramp, never pay anyone directly.
 */
export const CHALLENGE_RULES = {
  /** At most this many places pay in a ranked challenge (likes, Holder vote, the Owner), best first. */
  maxPlaces: 3,
  /** The most points one place of a ranked challenge can pay. */
  maxPoints: 20,
  /**
   * A challenge with one prize for every winner (raffle, first N, everyone who completes, ADR 0049)
   * names at most this many winners, and pays each at most `maxFlatPoints`: lower than a ranked place,
   * so a challenge with many winners can't inflate the ramp.
   */
  maxWinners: 25,
  maxFlatPoints: 10,
  /** "Everyone who completes" may ask for at most this many likes from other members. */
  maxMinLikes: 10,
  /** A raffle draws with the hash of a block this many past the newest one when it is settled (ADR 0049). */
  drawMargin: 10,
  /** A challenge ends when an epoch does: it runs to the end of the current one, or of one of the next `maxEpochs - 1`. */
  maxEpochs: 4,
  /** It can't start with less than this left in the epoch it would end with (hours). */
  minHours: 1,
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
  /**
   * An asset prize (ADR 0050), beside the points and never counted in an epoch: at most this many
   * NFTs for one winner, or this many whole tokens of an ERC-20.
   */
  maxPrizeNfts: 5,
  maxPrizeTokens: 1_000_000_000,
  /** An asset prize not reported sent this long after the challenge settled is overdue (ms). */
  prizeDueMs: 14 * 86_400_000,
  /** With `pinWinner`, a settled challenge's results stay pinned on top of the Board this long (ms). */
  pinResultsMs: 3 * 86_400_000,
} as const;

/**
 * At most this many challenge points count for one member in one epoch, whatever they won: a
 * Club's challenges can top up a member's points, not make them. Lives with the protocol rules'
 * spirit (the Owner can't raise it) and is applied where an epoch's inputs are read.
 */
export const CHALLENGE_CAP_PER_EPOCH = 20;

/**
 * How the winners are picked (ADR 0045, ADR 0049). Ranked ones pay 1 to 3 places, best first:
 * the members' likes, only Holders' likes, or the Owner's pick after the end. Flat ones pay every
 * winner the same: a verifiable random draw, the first entries in, or everyone who completes it.
 */
export const RANKED_JUDGING = ["likes", "holders", "owner"] as const;
export const FLAT_JUDGING = ["raffle", "first", "everyone"] as const;
export type RankedJudging = (typeof RANKED_JUDGING)[number];
export type FlatJudging = (typeof FLAT_JUDGING)[number];
export type Judging = RankedJudging | FlatJudging;

export const isFlat = (judging: Judging): judging is FlatJudging => (FLAT_JUDGING as readonly string[]).includes(judging);

/** Each way of picking winners in a few words, for the Owner's form and the cards. */
export const JUDGING: Record<Judging, { label: string; line: string }> = {
  likes: { label: "Most liked", line: "Entries are ranked by likes from other members. Likes lock when it ends." },
  holders: { label: "Holder vote", line: "Like Most liked, but only likes from Holders count." },
  owner: { label: "You pick", line: "After it ends you pick the winners, best first." },
  raffle: { label: "Raffle", line: "Winners are drawn at random from the entries, in a way anyone can check." },
  first: { label: "First in", line: "The first entries posted win. Later ones wait in line in case one drops out." },
  everyone: { label: "Everyone who completes", line: "Every entry that makes it wins, up to a limit. You can ask for a few likes." },
};

/** What the task is, whoever picks the winners. */
type TaskInput = {
  title: string;
  brief: string;
  /** How many epochs it runs, the current one included: 1 ends it when this epoch does. */
  epochs: number;
  /** Only Holders (the Holder badge) can enter. */
  holdersOnly: boolean;
  /** Rewards beside the points (ADR 0050): an asset prize the Owner sends, and pinning the results. */
  rewards?: RewardsInput;
};

/**
 * What an Owner may add to the points (ADR 0050). Every winner gets a trophy whatever is sent here.
 * `asset` is one verified asset and an amount for each paid place, best first (ranked), or the one
 * amount each winner gets (flat): NFTs for a collection, token units ("2.5") for an ERC-20.
 */
export type RewardsInput = {
  asset?: { token: string; amounts: (string | number)[] };
  pinWinner?: boolean;
};

/** An asset prize as it is kept: what the Owner sends each winner, from their own wallet. */
export type AssetPrize = {
  /** Lowercase. On the verified list when the challenge started. */
  token: string;
  kind: "erc721" | "erc20";
  name: string;
  symbol: string;
  /** ERC-20 only: the token's decimals, read from its contract when the challenge started. */
  decimals?: number;
  /** For each place, best first (ranked), or the one each winner gets (flat): NFTs, or the token's base units, as decimal strings. */
  amounts: string[];
};

/** Rewards beside the points (ADR 0050). The trophy isn't here: every winner gets one. */
export type ChallengeRewards = { asset?: AssetPrize; pinWinner?: true };

/** A ranked challenge pays its places, best first. */
export type RankedInput = TaskInput & { judging: RankedJudging; prizes: number[] };

/** A flat one pays `prize` points to each of up to `winners` winners; "everyone" may ask each entry for `minLikes`. */
export type FlatInput = TaskInput & { judging: FlatJudging; winners: number; prize: number; minLikes?: number };

/**
 * What an Owner sends to start a challenge. The points are what the epoch counts; trophies and an
 * asset prize are `rewards` beside them (ADR 0050), which no epoch reads.
 */
export type ChallengeInput = RankedInput | FlatInput;

/**
 * A checked challenge, in the shape it is kept: `prizes` is always the points of each place, best
 * first (a flat one's are `winners` equal ones), so the settling and the ledger read one list.
 */
export type CheckedChallenge = {
  title: string;
  brief: string;
  judging: Judging;
  prizes: number[];
  epochs: number;
  holdersOnly: boolean;
  winners?: number;
  prize?: number;
  minLikes?: number;
  rewards?: ChallengeRewards;
};

const whole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/**
 * What `checkChallenge` needs to check an asset prize: the verified list, and an ERC-20's decimals
 * as its contract reports them (the server reads them itself; the form passes what it read). Never
 * assumed: a token whose decimals aren't known can't be a prize yet.
 */
export type RewardsContext = { registry?: Pick<Registry, "entry">; decimals?: (token: string) => number | null | undefined };

/** "3" or 3 NFTs: a whole number from 0 to `maxPrizeNfts`. */
function parseCount(v: unknown): bigint | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= CHALLENGE_RULES.maxPrizeNfts ? BigInt(n) : null;
}

/** "2.5" tokens at `decimals`, in base units: no more decimals than the token has, at most `maxPrizeTokens` whole. */
function parseTokens(v: unknown, decimals: number): bigint | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,18}(\.\d+)?$/.test(s) || (s.split(".")[1]?.length ?? 0) > decimals) return null;
  const amount = parseUnits(s, decimals);
  return amount <= BigInt(CHALLENGE_RULES.maxPrizeTokens) * 10n ** BigInt(decimals) ? amount : null;
}

/** Checks the rewards beside the points (ADR 0050) against `places` paid places, or one amount for a flat prize. */
export function checkRewards(raw: unknown, places: number, flat: boolean, ctx: RewardsContext = {}): { ok: true; rewards?: ChallengeRewards } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "Send the rewards as an object." };
  const { asset, pinWinner } = raw as Record<string, unknown>;
  if (pinWinner !== undefined && typeof pinWinner !== "boolean") return { ok: false, message: "pinWinner is true or false." };
  const out: ChallengeRewards = pinWinner ? { pinWinner: true } : {};
  if (asset !== undefined && asset !== null) {
    if (typeof asset !== "object" || Array.isArray(asset)) return { ok: false, message: "Send the asset prize as { token, amounts }." };
    const { token, amounts } = asset as Record<string, unknown>;
    if (typeof token !== "string" || !isAddress(token, { strict: false })) return { ok: false, message: "Choose the NFT or token to give." };
    const entry = (ctx.registry ?? defaultRegistry).entry(token);
    if (!entry || entry.status !== "verified") return { ok: false, message: "Only an asset on DeClub’s verified list can be a prize." };
    if (!Array.isArray(amounts) || amounts.length !== (flat ? 1 : places)) {
      return { ok: false, message: flat ? "Give one amount: what each winner gets." : "Give one amount for each paid place." };
    }
    let decimals: number | undefined;
    if (entry.kind === "erc20") {
      const d = ctx.decimals?.(token);
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 36) return { ok: false, message: `Reading ${entry.symbol}’s decimals from its contract. Try again in a moment.` };
      decimals = d;
    }
    const parsed: bigint[] = [];
    for (const a of amounts) {
      const v = decimals === undefined ? parseCount(a) : parseTokens(a, decimals);
      if (v === null) {
        return {
          ok: false,
          message:
            decimals === undefined
              ? `Each winner gets a whole number of NFTs, up to ${CHALLENGE_RULES.maxPrizeNfts}.`
              : `Amounts are in ${entry.symbol}: up to ${CHALLENGE_RULES.maxPrizeTokens.toLocaleString("en-US")}, with at most ${decimals} decimals.`,
        };
      }
      if (parsed.length > 0 && v > parsed[parsed.length - 1]!) return { ok: false, message: "A lower place can’t get more of the asset than a higher one." };
      parsed.push(v);
    }
    if (parsed[0] === 0n) return { ok: false, message: flat ? "Give each winner more than 0." : "The 1st place gets more than 0." };
    out.asset = { token: token.toLowerCase(), kind: entry.kind, name: entry.name, symbol: entry.symbol, ...(decimals !== undefined ? { decimals } : {}), amounts: parsed.map(String) };
  }
  return { ok: true, ...(Object.keys(out).length > 0 ? { rewards: out } : {}) };
}

/** Checks what an Owner sent to start a challenge; the Owner's form shows its message as they type. */
export function checkChallenge(input: unknown, ctx: RewardsContext = {}): { ok: true; challenge: CheckedChallenge } | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, message: "Send the challenge as an object." };
  const { title, brief, judging, prizes, winners, prize, minLikes, epochs, holdersOnly, rewards } = input as Record<string, unknown>;
  const t = cleanLine(title, CHALLENGE_RULES.titleMax);
  if (!t.ok) return { ok: false, message: t.reason === "empty" ? "Give the challenge a title." : `The title is at most ${CHALLENGE_RULES.titleMax} characters.` };
  const b = cleanLine(brief, CHALLENGE_RULES.briefMax);
  if (!b.ok) return { ok: false, message: b.reason === "empty" ? "Say what members should do." : `The brief is at most ${CHALLENGE_RULES.briefMax} characters.` };
  if (typeof judging !== "string" || !(judging in JUDGING)) return { ok: false, message: "Choose how the winners are picked." };
  const task = { title: t.text, brief: b.text, judging: judging as Judging };
  let paid: Pick<CheckedChallenge, "prizes" | "winners" | "prize" | "minLikes">;
  if (isFlat(task.judging)) {
    if (prizes !== undefined) return { ok: false, message: "This way of picking pays every winner the same: send winners and prize, not places." };
    if (!whole(winners, 1, CHALLENGE_RULES.maxWinners)) return { ok: false, message: `Have between 1 and ${CHALLENGE_RULES.maxWinners} winners.` };
    if (!whole(prize, 0, CHALLENGE_RULES.maxFlatPoints)) return { ok: false, message: `Each winner gets a whole number of points, 0 to ${CHALLENGE_RULES.maxFlatPoints}.` };
    if (task.judging === "everyone") {
      if (minLikes !== undefined && !whole(minLikes, 0, CHALLENGE_RULES.maxMinLikes)) return { ok: false, message: `Ask for 0 to ${CHALLENGE_RULES.maxMinLikes} likes.` };
    } else if (minLikes !== undefined) return { ok: false, message: "Only “Everyone who completes” asks for likes." };
    paid = { prizes: Array.from({ length: winners }, () => prize), winners, prize, ...(task.judging === "everyone" ? { minLikes: (minLikes as number | undefined) ?? 0 } : {}) };
  } else {
    if (winners !== undefined || prize !== undefined || minLikes !== undefined) return { ok: false, message: "This way of picking pays places: send prizes, best first." };
    if (!Array.isArray(prizes) || prizes.length < 1 || prizes.length > CHALLENGE_RULES.maxPlaces) {
      return { ok: false, message: `Pay between 1 and ${CHALLENGE_RULES.maxPlaces} places.` };
    }
    let last = Infinity;
    for (const p of prizes) {
      if (!whole(p, 0, CHALLENGE_RULES.maxPoints)) return { ok: false, message: `Each place pays a whole number of points, 0 to ${CHALLENGE_RULES.maxPoints}.` };
      if (p > last) return { ok: false, message: "A lower place can't pay more than a higher one." };
      last = p;
    }
    paid = { prizes: prizes as number[] };
  }
  if (!whole(epochs, 1, CHALLENGE_RULES.maxEpochs)) return { ok: false, message: `It runs for 1 to ${CHALLENGE_RULES.maxEpochs} epochs.` };
  if (holdersOnly !== undefined && typeof holdersOnly !== "boolean") return { ok: false, message: "holdersOnly is true or false." };
  const extra = checkRewards(rewards, paid.prizes.length, isFlat(task.judging), ctx);
  if (!extra.ok) return extra;
  return { ok: true, challenge: { ...task, ...paid, epochs, holdersOnly: holdersOnly === true, ...(extra.rewards ? { rewards: extra.rewards } : {}) } };
}

/** What the server keeps for one challenge. `userId`s never leave the server. */
export type StoredChallenge = {
  id: string;
  title: string;
  brief: string;
  judging: Judging;
  /** Points per place, best first; a flat challenge's are `winners` equal ones. */
  prizes: number[];
  /** A flat challenge's number of winners and points each (ADR 0049). */
  winners?: number;
  prize?: number;
  /** "Everyone who completes": the likes from other members an entry needs (0: any entry). */
  minLikes?: number;
  /** Only Holders could enter. Absent in challenges started before. */
  holdersOnly?: boolean;
  /** Epoch ms. Entries must be posted in `[startsAt, endsAt)`; `endsAt` is the end of an epoch. */
  startsAt: number;
  endsAt: number;
  /** The Owner's (or admin's) wallet when they started it. */
  by: string;
  state: "live" | "settled" | "cancelled";
  /**
   * A raffle, once it has ended: the block whose hash draws it, committed before it exists, and the
   * entries it draws from, sorted (ADR 0049).
   */
  drawBlock?: number;
  drawPool?: string[];
  settled?: Settlement;
  /** Rewards beside the points (ADR 0050). Absent in challenges started before, and when none were set. */
  rewards?: ChallengeRewards;
  /** Server only: the user behind each winner owed an asset prize, by post id, to read their linked wallets. */
  prizeUsers?: Record<string, string>;
};

/**
 * One winner. `prize` is what the Owner owes them of the asset prize (NFTs, or base units), absent
 * when there is none; `sent` is the transfer that paid it, checked on chain (ADR 0050).
 */
export type Winner = { post: string; wallet: string; place: number; points: number; likes?: number; prize?: string; sent?: { tx: string; at: number } };

/** How a raffle was drawn, so anyone can draw it again (`drawSeed`, `drawOrder`). */
export type Draw = {
  /** The block committed when the raffle was settled, and its hash. */
  block: number;
  hash: string;
  /** keccak256(hash ‖ the challenge id as UTF-8). */
  seed: string;
  /** The entries drawn from, sorted by post id. The first `winners` of them in draw order that could still win won. */
  pool: string[];
};

/** How a challenge ended: who won and the epoch their points count in. */
export type Settlement = {
  at: number;
  /** The epoch the points count in; absent when no points were paid. */
  epoch?: number;
  winners: Winner[];
  /** The Owner didn't pick in time. */
  expired?: true;
  /** A raffle's draw (ADR 0049). */
  draw?: Draw;
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

/** Still running or waiting on its result: pinned on top of the Board, and listed first on the Challenges tab. */
export const isLive = (phase: Phase) => phase === "open" || phase === "closing" || phase === "judging";

/**
 * Whether the likes on its entries decide who wins, so they lock when it ends (`votingClosed`): by
 * likes, by Holders' likes, and "everyone who completes" when it asks for likes.
 */
export const likesDecide = (c: Pick<StoredChallenge, "judging" | "minLikes">) => c.judging === "likes" || c.judging === "holders" || (c.judging === "everyone" && (c.minLikes ?? 0) > 0);

/**
 * Why a Board post can't be a challenge's entry as an X post, or null when it can: an entry is the
 * member's own X post (from the X account linked to their profile, ADR 0024), shared to the Board,
 * and posted on X while the challenge runs, so a challenge sends the Club out onto X and an old post
 * can't be recycled.
 */
export function xEntryProblem(post: Pick<StoredPost, "link" | "x">, c: Pick<StoredChallenge, "startsAt" | "endsAt">): "not_x" | "x_not_own" | "x_too_old" | null {
  if (post.link?.kind !== "x" || !post.x) return "not_x";
  if (!post.x.own) return "x_not_own";
  if (post.x.postedAt === null || post.x.postedAt < c.startsAt || post.x.postedAt >= c.endsAt) return "x_too_old";
  return null;
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
  /** The X post it shares, as the server read it; absent for a hidden post, or one entered before entries were X posts. */
  x?: StoredXCard;
  place?: number;
  /** In a Holder vote, the likes from Holders: what counts (ADR 0049). */
  votes?: number;
};

export type PublicChallenge = {
  id: string;
  title: string;
  brief: string;
  judging: Judging;
  prizes: number[];
  holdersOnly: boolean;
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
  /** A flat challenge's number of winners and points each, and what "everyone who completes" asks for (ADR 0049). */
  winners?: number;
  prize?: number;
  minLikes?: number;
  /** A raffle being drawn: the block whose hash will draw it. */
  drawBlock?: number;
  /** Rewards beside the points (ADR 0050). */
  rewards?: ChallengeRewards;
  /** A settled challenge with an asset prize: when a prize not sent by then is overdue (epoch ms). */
  prizeDueBy?: number;
  /** Results the Owner pinned: on top of the Board until then (epoch ms). */
  pinUntil?: number;
};

/** A trophy, kept per member across Clubs (ADR 0050): one for every win, whatever the prize. */
export type Trophy = {
  club: string;
  challenge: string;
  title: string;
  /** 1 to 3 in a ranked challenge; null for a flat one, where every winner simply won. */
  place: number | null;
  /** When the challenge settled (epoch ms). */
  at: number;
  /** The wallet the win was published under, so a profile only shows the wins of its own wallet. */
  wallet: string;
};

/** A trophy as a profile or a member row shows it. */
export type PublicTrophy = Omit<Trophy, "wallet"> & { clubName: string };

/** The place a trophy records: the medal of a ranked win, none for a flat one. */
export const trophyPlace = (judging: Judging, place: number): number | null => (isFlat(judging) ? null : place);

/** What a winner at `place` is owed of the asset prize, or null: a lower place may get none. */
export function assetFor(c: { judging: Judging; rewards?: ChallengeRewards }, place: number): string | null {
  const asset = c.rewards?.asset;
  if (!asset) return null;
  const amount = isFlat(c.judging) ? asset.amounts[0] : asset.amounts[place - 1];
  return amount && amount !== "0" ? amount : null;
}

/** "1 NFT", "3 NFTs", "2.5 USDC": an amount of an asset prize, short, for a tile. */
export function assetShort(asset: Pick<AssetPrize, "kind" | "symbol" | "decimals">, amount: string): string {
  if (asset.kind === "erc721") return `${amount} NFT${amount === "1" ? "" : "s"}`;
  return `${formatUnits(BigInt(amount), asset.decimals ?? 0)} ${asset.symbol}`;
}

/** "1 NFT from Chogs", "2.5 USDC": an amount of an asset prize in words. */
export function assetText(asset: Pick<AssetPrize, "kind" | "symbol" | "name" | "decimals">, amount: string): string {
  return asset.kind === "erc721" ? `${assetShort(asset, amount)} from ${asset.name}` : assetShort(asset, amount);
}

export type PrizeStatus = "owed" | "overdue" | "sent";

/** Where a winner's asset prize stands: sent (checked on chain), owed, or overdue past `prizeDueMs`; null when they have none. */
export function prizeStatus(w: Pick<Winner, "prize" | "sent">, settledAt: number, now: number): PrizeStatus | null {
  if (!w.prize) return null;
  if (w.sent) return "sent";
  return now >= settledAt + CHALLENGE_RULES.prizeDueMs ? "overdue" : "owed";
}

/** Whether any winner of `c` is still owed their asset prize past the due time. */
export const prizeOverdue = (c: { settled?: Settlement }, now: number) => !!c.settled && c.settled.winners.some((w) => prizeStatus(w, c.settled!.at, now) === "overdue");

/** On top of the Board: still running or waiting on its result, or results the Owner pinned, for `pinResultsMs`. */
export const isPinned = (c: Pick<PublicChallenge, "phase" | "pinUntil">, nowMs: number) => isLive(c.phase) || (c.pinUntil !== undefined && nowMs < c.pinUntil);

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

/**
 * The winners of a "first in" or "everyone who completes" challenge (ADR 0049): the earliest
 * entries by Board post time (then post id) with at least `minLikes` likes from other members, a
 * member once, at most `n`, each paid `prize`. Later ones are reserves: one ahead dropping out (a
 * hidden post, a ban) moves them up.
 */
export function winnersByTime(candidates: readonly Candidate[], n: number, prize: number, minLikes = 0): Winner[] {
  const inOrder = candidates.filter((c) => c.likes >= minLikes).sort((a, b) => a.at - b.at || (a.post < b.post ? -1 : a.post > b.post ? 1 : 0));
  const out: Winner[] = [];
  const seen = new Set<string>();
  for (const c of inOrder) {
    if (out.length >= n) break;
    if (seen.has(c.userId)) continue;
    seen.add(c.userId);
    out.push({ post: c.post, wallet: c.wallet, place: out.length + 1, points: prize, likes: c.likes });
  }
  return out;
}

/**
 * A raffle's seed (ADR 0049): keccak256 of the committed block's hash followed by the challenge id
 * as UTF-8 bytes. The block is chosen after entries close and before it exists, so nobody (the app
 * included) knows the seed while it could still change the entries.
 */
export const drawSeed = (blockHash: Hex, challengeId: string): Hex => keccak256(concat([blockHash, stringToHex(challengeId)]));

/**
 * The draw order of `posts` for `seed`: sorted by post id, then a Fisher–Yates shuffle from the last
 * position down, position `i` swapping with `keccak256(seed ‖ uint256(i)) mod (i + 1)`. Anyone with
 * the seed and the pool gets the same order.
 */
export function drawOrder(seed: Hex, posts: readonly string[]): string[] {
  const out = [...new Set(posts)].sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Number(hexToBigInt(keccak256(concat([seed, numberToHex(i, { size: 32 })]))) % BigInt(i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * A raffle's winners: `pool` (the entries committed when it was settled, `candidates`' own by
 * default) in draw order, keeping the first `n` that are still among `candidates`, a member once.
 * An entry that dropped out after the commit is skipped, not redrawn, so nobody can reroll it.
 */
export function drawWinners<T extends { post: string; userId?: string }>(seed: Hex, candidates: readonly T[], n: number, pool: readonly string[] = candidates.map((c) => c.post)): T[] {
  const byPost = new Map(candidates.map((c) => [c.post, c]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const post of drawOrder(seed, pool)) {
    if (out.length >= n) break;
    const c = byPost.get(post);
    if (!c || (c.userId !== undefined && seen.has(c.userId))) continue;
    if (c.userId !== undefined) seen.add(c.userId);
    out.push(c);
  }
  return out;
}

/** The prizes in words: "10, 5 and 2 points". */
export function prizeText(prizes: readonly number[]): string {
  if (prizes.length === 1) return `${prizes[0]} point${prizes[0] === 1 ? "" : "s"}`;
  return `${prizes.slice(0, -1).join(", ")} and ${prizes[prizes.length - 1]} points`;
}

/** A flat challenge's prize in words: "5 winners · +3 pts each", or a trophy when it pays no points. */
export function flatPrizeText(c: Pick<PublicChallenge, "winners" | "prize">): string {
  const n = c.winners ?? 1;
  return `${n} winner${n === 1 ? "" : "s"} · ${c.prize ? `+${c.prize} pts each` : "trophy only"}`;
}

/** Who decides, in a few words for a card: "Most liked wins", "Random draw of 5". */
export function judgingText(c: Pick<PublicChallenge, "judging" | "winners" | "minLikes">): string {
  const n = c.winners ?? 1;
  switch (c.judging) {
    case "likes":
      return "Most liked wins";
    case "holders":
      return "Holders’ likes decide";
    case "owner":
      return "Owner picks";
    case "raffle":
      return `Random draw of ${n}`;
    case "first":
      return `First ${n} in win`;
    case "everyone":
      return c.minLikes ? `Everyone with ${c.minLikes}+ like${c.minLikes === 1 ? "" : "s"} wins` : "Everyone who completes wins";
  }
}
