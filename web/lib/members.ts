import { memberScore, type Scores } from "./momentum";
import type { ActivityEvent } from "./clubs";
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
  /** Set for the Club's Owner and Moderators. */
  role?: "owner" | "moderator";
};

export type MemberSort = "momentum" | "new";

export type MembersView = {
  /** The top `MEMBERS_SHOWN` of the sort. */
  members: PublicMember[];
  total: number;
  holders: number;
};

/** A balance is re-read when its check is older than this. */
export const HOLDER_RECHECK_MS = 24 * 60 * 60 * 1000;
/** The most rows one request re-checks, so a big Club can't turn a page load into a flood of reads. */
export const RECHECK_PER_READ = 50;
/** How many members the list shows. */
export const MEMBERS_SHOWN = 100;
/** A Club stops taking members here (the list reads every row, so it is bounded). */
export const MAX_MEMBERS = 2_000;

/**
 * Whether these balances (one per linked wallet, base units) earn the Holder badge: any NFT of an
 * ERC-721 Club, or at least `minHolding` of an ERC-20 one (any balance when the entry sets none).
 */
export function isHolder(entry: Pick<AssetEntry, "kind" | "minHolding">, balances: readonly bigint[]): boolean {
  const total = balances.reduce((sum, balance) => sum + balance, 0n);
  const least = entry.kind === "erc20" && entry.minHolding ? BigInt(entry.minHolding) : 1n;
  return total >= least;
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

/** Rows whose balance is out of date, oldest check first, at most `limit`. */
export function staleRows(rows: readonly MemberRow[], now: number, limit = RECHECK_PER_READ): MemberRow[] {
  return rows
    .filter((row) => now - row.holderCheckedAt >= HOLDER_RECHECK_MS)
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
): MembersView {
  const swaps = events.filter((e) => e.kind === "swapped");
  const all: PublicMember[] = rows.map((row) => {
    const own = new Set(row.wallets);
    return {
      wallet: row.displayWallet,
      holder: row.holder,
      joinedAt: row.joinedAt,
      momentum: memberScore(scores, row.wallets),
      swaps: swaps.filter((e) => e.parties.some((p) => own.has(p.toLowerCase()))).length,
      ...(roles?.owner === row.userId ? { role: "owner" as const } : roles?.moderators.includes(row.userId) ? { role: "moderator" as const } : {}),
    };
  });
  // Ties fall back to the earlier join, so the order is stable between reads.
  const byJoin = (a: PublicMember, b: PublicMember) => a.joinedAt - b.joinedAt || (a.wallet < b.wallet ? -1 : 1);
  all.sort(sort === "new" ? (a, b) => byJoin(b, a) : (a, b) => b.momentum - a.momentum || byJoin(a, b));
  return { members: all.slice(0, MEMBERS_SHOWN), total: all.length, holders: all.filter((m) => m.holder).length };
}
