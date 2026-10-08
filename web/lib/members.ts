import { memberScore, type Scores } from "./momentum";
import type { ActivityEvent } from "./clubs";
import type { CoinHolders } from "./clubPosts";
import type { Roles } from "./clubRoles";
import type { AssetEntry } from "./verifiedAssets";

/**
 * Club membership, as far as it can be worked out without a server (ADR 0016, docs/09-clubs.md):
 * who counts as a Holder, which wallet stands for a member, and how a Club's members are ranked.
 * Shared by the routes and the tests.
 */

/** What the server keeps for a member of a Club. Never sent as it is: the user id stays private. */
export type MemberRow = {
  userId: string;
  /** Lowercase. Every Ethereum wallet linked to the user when the row was last written. */
  wallets: string[];
  /** Lowercase. The wallet the Members list shows: one with a shared profile, else the first. */
  displayWallet: string;
  holder: boolean;
  /** Epoch ms of the last balance check; 0 when it hasn't run (or its wallets just changed). */
  holderCheckedAt: number;
  /** Epoch ms. */
  joinedAt: number;
};

/** A member as everyone sees them. */
export type PublicMember = {
  wallet: string;
  holder: boolean;
  joinedAt: number;
  momentum: number;
  /** Completed swaps the member's wallets were part of. */
  swaps: number;
  /** 1-based place in the whole Club under the sort asked for, so a search keeps true ranks. */
  rank: number;
  /** Set for the Club's Owner and Moderators. */
  role?: "owner" | "moderator";
  /** Epochs in a row with enough active days on the Board (ADR 0032), when still alive. */
  streak?: number;
  /** The challenges they won in this Club under this wallet (ADR 0050), newest first; absent when none. */
  trophies?: { challenge: string; title: string; place: number | null }[];
};

export type MemberSort = "momentum" | "new";

export type MembersView = {
  /** One page of the sort. */
  members: PublicMember[];
  /** Everyone in the Club. */
  total: number;
  /** How many of them match the search; all of them without one. The pages count these. */
  matches: number;
  holders: number;
  /** The highest Momentum in the Club, so a page's meters share one scale. */
  topMomentum: number;
  /** The page served (1-based) and its size, as the server clamped them. */
  page: number;
  size: number;
};

export type MembersPaging = {
  page: number;
  size: number;
  /** Text to find in a member's wallet or in the X / Discord handle they show. */
  query?: string;
  /** Lowercase display wallet to the handle it shows, for the search. */
  handles?: ReadonlyMap<string, string>;
};

/** The longest search the server reads. */
export const MEMBERS_QUERY_MAX = 64;

/** Whether a wallet, or the handle shown under it, contains `query` (an "@" in front is ignored). */
function matchesMember(wallet: string, handle: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  return wallet.toLowerCase().includes(q) || (handle?.toLowerCase().includes(q) ?? false);
}

/** A balance is re-read when its check is older than this. */
export const HOLDER_RECHECK_MS = 24 * 60 * 60 * 1000;
/** A member's own badge is re-read when they ask (their membership, a Holders-only entry) and its check is older than this. */
export const HOLDER_SELF_RECHECK_MS = 60 * 1000;
/** The most rows one request re-checks, so a big Club can't turn a page load into a flood of reads. */
export const RECHECK_PER_READ = 50;
/** How many members a request returns when it doesn't say. */
export const MEMBERS_SHOWN = 100;
/** The page the Members tab asks for, and the most one request may return. */
export const MEMBERS_PAGE = 25;
export const MEMBERS_MAX_PAGE = 100;
/** A Club stops taking members here (the list reads every row, so it is bounded). */
export const MAX_MEMBERS = 2_000;

/** Whether a Club's memecoin earns the Holder badge, and from how much (base units). */
export type CoinRule = { on: boolean; min: bigint };

/**
 * The coin's rule: the Owner's setting (ADR 0026), else the list's `minHolding`, any balance
 * without one.
 */
export function coinRule(coin: Pick<AssetEntry, "minHolding">, setting?: CoinHolders): CoinRule {
  if (setting) return { on: setting.on, min: BigInt(setting.min) };
  return { on: true, min: coin.minHolding ? BigInt(coin.minHolding) : 1n };
}

/**
 * Whether these balances (one per linked wallet, base units) of one Club asset earn the Holder
 * badge: any NFT of the collection, or the coin's minimum when the Club counts its coin.
 */
export function isHolder(entry: Pick<AssetEntry, "kind" | "minHolding">, balances: readonly bigint[], rule = coinRule(entry)): boolean {
  const total = balances.reduce((sum, balance) => sum + balance, 0n);
  if (entry.kind === "erc721") return total >= 1n;
  return rule.on && total >= rule.min;
}

/** The wallet to show for a member: the first one with a shared profile, else the first linked. */
export function pickDisplayWallet(wallets: readonly string[], shared: ReadonlySet<string>): string | undefined {
  const lower = wallets.map((w) => w.toLowerCase());
  return lower.find((w) => shared.has(w)) ?? lower[0];
}

const sameWallets = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((w) => b.includes(w));

/**
 * The row after the user's linked wallets changed, or the same row when nothing did. New wallets
 * mean the balance is unknown, so the next read of the list checks it again.
 */
export function withWallets(row: MemberRow, wallets: readonly string[], display: string): MemberRow {
  const lower = wallets.map((w) => w.toLowerCase());
  const changed = !sameWallets(row.wallets, lower);
  if (!changed && row.displayWallet === display) return row;
  return { ...row, wallets: lower, displayWallet: display, holderCheckedAt: changed ? 0 : row.holderCheckedAt };
}

/**
 * Rows whose balance is out of date, oldest check first, at most `limit`. A row checked before
 * `since` (epoch ms: when the Holder rule last changed) is out of date too.
 */
export function staleRows(rows: readonly MemberRow[], now: number, limit = RECHECK_PER_READ, since = 0): MemberRow[] {
  return rows
    .filter((row) => now - row.holderCheckedAt >= HOLDER_RECHECK_MS || row.holderCheckedAt < since)
    .sort((a, b) => a.holderCheckedAt - b.holderCheckedAt)
    .slice(0, limit);
}

/** The Members list: each member with their Momentum and swaps, in the order asked for. */
export function rankMembers(
  rows: readonly MemberRow[],
  scores: Scores,
  events: readonly ActivityEvent[],
  sort: MemberSort,
  roles?: Roles,
  /** Each member's live streak, by user id. */
  streaks?: ReadonlyMap<string, number>,
  paging: MembersPaging = { page: 1, size: MEMBERS_SHOWN },
): MembersView {
  const swaps = events.filter((e) => e.kind === "swapped");
  const all: PublicMember[] = rows.map((row) => {
    const own = new Set(row.wallets);
    return {
      wallet: row.displayWallet,
      rank: 0,
      holder: row.holder,
      joinedAt: row.joinedAt,
      momentum: memberScore(scores, row.wallets),
      swaps: swaps.filter((e) => e.parties.some((p) => own.has(p.toLowerCase()))).length,
      ...(roles?.owner === row.userId ? { role: "owner" as const } : roles?.moderators.includes(row.userId) ? { role: "moderator" as const } : {}),
      ...(streaks?.get(row.userId) ? { streak: streaks.get(row.userId) } : {}),
    };
  });
  // Ties fall back to the earlier join, so the order is stable between reads.
  const byJoin = (a: PublicMember, b: PublicMember) => a.joinedAt - b.joinedAt || (a.wallet < b.wallet ? -1 : 1);
  all.sort(sort === "new" ? (a, b) => byJoin(b, a) : (a, b) => b.momentum - a.momentum || byJoin(a, b));
  all.forEach((m, i) => (m.rank = i + 1));
  const query = paging.query?.trim() ?? "";
  const found = query ? all.filter((m) => matchesMember(m.wallet, paging.handles?.get(m.wallet), query)) : all;
  // A page past the end is the last one, so a Club that shrank doesn't leave a reader on an empty page.
  const size = Math.min(MEMBERS_MAX_PAGE, Math.max(1, Math.floor(paging.size)));
  const page = Math.min(Math.max(1, Math.floor(paging.page)), Math.max(1, Math.ceil(found.length / size)));
  return {
    members: found.slice((page - 1) * size, page * size),
    total: all.length,
    matches: found.length,
    holders: all.filter((m) => m.holder).length,
    topMomentum: Math.max(0, ...all.map((m) => m.momentum)),
    page,
    size,
  };
}
