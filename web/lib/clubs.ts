import type { Settlement } from "./intents";
import type { AssetEntry, ClubEntry } from "./verifiedAssets";
import { DECLUB_INTENTS_ADDRESS } from "./config";
import { score, trend, type ActivityKind, type ScoredEvent } from "./momentum";

/**
 * What a Club's page shows, worked out from its activity (ADR 0016, docs/09-clubs.md). Pure, so
 * the server routes and the tests share it.
 */

/** One thing that happened to a Club's asset. Field order is fixed: the log stores it as JSON. */
export type ActivityEvent = {
  /** `txHash:logIndex` for escrow events (`txHash:settled` for a signed swap, `x:<tweet>` for an X share, `post:<id>` for a Board post), so a replayed report is the same event. */
  id: string;
  kind: ActivityKind;
  /** The contract that emitted it, lowercase. */
  contract: string;
  /** The DeClubEscrow trade id; for a signed swap, the settlement's transaction hash. */
  deal: string;
  block: number;
  /** Unix seconds (the block's timestamp). */
  at: number;
  /** Lowercase wallets: the maker for a creation, every side for a swap. */
  parties: string[];
  /** Every non-native token the deal names, lowercase. */
  tokens: string[];
  /**
   * A completed swap's protocol fee, every side together, in wei (a decimal string). Escrow swaps
   * carry it from the receipt's `FeeCharged`; signed swaps get it when an epoch is built
   * (lib/server/rewards.ts). Absent when there was no fee or it isn't known yet.
   */
  fee?: string;
  /** An X share's strength factor (lib/xPosts.ts `strengthFactor`). */
  weight?: number;
  /** An X share that is a challenge entry (ADR 0048): it counts toward Momentum, not toward epoch points. */
  entry?: true;
};

export const toScored = (e: ActivityEvent): ScoredEvent => ({
  kind: e.kind,
  at: e.at,
  parties: e.parties,
  ...(e.weight !== undefined ? { weight: e.weight } : {}),
});

export type ClubStats = {
  /** Club Momentum. */
  momentum: number;
  /** Momentum now minus a week ago. */
  change: number;
  /** Completed swaps in the last 7 days. */
  completed7d: number;
  /** New deals, open offers and intents in the last 7 days. */
  created7d: number;
  /** Distinct wallets in the last 30 days. */
  traders30d: number;
  /** Members' own X posts about the Club shared on its Board in the last 7 days. */
  xShares7d: number;
  /** Holders' Board posts that counted toward Momentum in the last 7 days: one a day per member. */
  posts7d: number;
  /** Unix seconds of the latest event, or null. */
  lastActive: number | null;
};

const DAY = 86_400;

export function summarize(events: readonly ActivityEvent[], now: number): ClubStats {
  const scored = events.map(toScored);
  const t = trend(scored, now);
  const week = events.filter((e) => e.at > now - 7 * DAY && e.at <= now);
  return {
    momentum: t.score,
    change: t.change,
    completed7d: week.filter((e) => e.kind === "swapped").length,
    created7d: week.filter((e) => e.kind === "created").length,
    xShares7d: week.filter((e) => e.kind === "xshare").length,
    posts7d: week.filter((e) => e.kind === "post").length,
    traders30d: score(scored, now).uniqueWallets,
    lastActive: events.reduce<number | null>((latest, e) => (latest === null || e.at > latest ? e.at : latest), null),
  };
}

/**
 * Signed swaps as activity events, from the pool's settled cycles. Every maker in the cycle is a
 * party, and the tokens are whatever the cycle's intents give or want.
 */
export function settlementEvents(settlements: readonly Settlement[]): ActivityEvent[] {
  return settlements.map((s) => {
    const makers = s.cycle.map((row) => row.intent.maker.toLowerCase());
    const tokens = s.cycle.flatMap((row) => [...row.intent.give, ...row.intent.want].filter((a) => a.kind !== "native").map((a) => a.token.toLowerCase()));
    return {
      id: `${s.txHash.toLowerCase()}:settled`,
      kind: "swapped" as const,
      contract: (DECLUB_INTENTS_ADDRESS ?? "").toLowerCase(),
      deal: s.txHash.toLowerCase(),
      block: s.blockNumber,
      at: Math.floor(s.at / 1000),
      parties: [...new Set(makers)],
      tokens: [...new Set(tokens)],
    };
  });
}

/** Events from several sources as one list: each id once, newest first. */
export function mergeEvents(...lists: ReadonlyArray<readonly ActivityEvent[]>): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
}

/** Completed swaps, newest first. */
export const completedSwaps = (events: readonly ActivityEvent[], limit: number) => mergeEvents(events.filter((e) => e.kind === "swapped")).slice(0, limit);

/** One asset of a Club. */
export type ClubAsset = { token: string; kind: "erc721" | "erc20"; name: string; symbol: string };

/** What a Club is, from the assets list (the part that doesn't change with activity). */
export type ClubInfo = {
  /** Lowercase address. */
  token: string;
  name: string;
  symbol: string;
  kind: "erc721" | "erc20";
  archived: boolean;
  note: string;
  /** The Club's art, a path under `public/`, when the list gives one. */
  image?: string;
  /** The memecoin that shares this collection's Club, if it has one. */
  linked?: ClubAsset;
};

const toAsset = (entry: AssetEntry): ClubAsset => ({ token: entry.address.toLowerCase(), kind: entry.kind, name: entry.name, symbol: entry.symbol });

export const toClubInfo = (entry: ClubEntry): ClubInfo => ({
  token: entry.address.toLowerCase(),
  name: entry.name,
  symbol: entry.symbol,
  kind: entry.kind,
  archived: entry.club === "archived",
  note: entry.note,
  ...(entry.image ? { image: entry.image } : {}),
  ...(entry.linked ? { linked: toAsset(entry.linked) } : {}),
});

/** Every asset of the Club, its own first. */
export const infoAssets = (info: ClubInfo): ClubAsset[] => [info, ...(info.linked ? [info.linked] : [])];

/** A Club as the list and the detail show it. */
export type ClubSummary = ClubInfo & { stats: ClubStats; members: number };

/** `holders` is how many members held the asset at their last check. */
export type ClubDetail = { club: ClubSummary; recent: ActivityEvent[]; holders: number };

/** Up to two letters from the asset's name ("Mock Chog" → "MC"), for a Club's tile. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

/**
 * Momentum in words, so a number nobody has a feel for still says something. One fresh swap
 * between two wallets scores about 10 (lib/momentum.ts), which sets the steps: a single trade is
 * "Active", a handful in a week is "Busy".
 */
export const HEAT = [
  { min: 0, label: "Quiet" },
  { min: 0.5, label: "Stirring" },
  { min: 5, label: "Active" },
  { min: 25, label: "Busy" },
  { min: 75, label: "Hot" },
] as const;

/** The heat step for a Momentum: 0 (quiet) to 4 (hot), with its label. */
export function heat(momentum: number): { level: number; label: string } {
  let level = 0;
  HEAT.forEach((step, i) => {
    if (momentum >= step.min) level = i;
  });
  return { level, label: HEAT[level].label };
}
