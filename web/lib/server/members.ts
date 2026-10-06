import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";
import { chain } from "../chain";
import { CHAIN_ID, RPC_URL } from "../config";
import type { ActivityEvent } from "../clubs";
import {
  MAX_MEMBERS,
  isHolder,
  pickDisplayWallet,
  rankMembers,
  staleRows,
  withWallets,
  type MemberRow,
  type MemberSort,
  type MembersView,
} from "../members";
import { score } from "../momentum";
import { profileKey, userWalletsKey, type StoredProfile } from "../profiles";
import { clubAssets, type ClubEntry } from "../verifiedAssets";
import { withoutUser } from "../clubRoles";
import { isBanned, loadRoles, saveRoles } from "./clubState";
import type { Store } from "./store";

/**
 * Club membership in the store (ADR 0016, docs/09-clubs.md). A member is a Privy user, kept by
 * user id; their wallets are copied from Privy's linked accounts, never from a request. The Holder
 * badge is a balance read on the server and is out of date by at most a day.
 */

export const membersKey = (token: string) => `declub:club:${CHAIN_ID}:${token.toLowerCase()}:members`;
export const memberKey = (token: string, userId: string) => `declub:club-member:${CHAIN_ID}:${token.toLowerCase()}:${userId}`;
export const userClubsKey = (userId: string) => `declub:user-clubs:${userId}`;

/**
 * One balance per wallet, in the same order, or `null` when the chain can't be read. The same
 * `balanceOf` answers for ERC-721 and ERC-20.
 */
export type Holdings = (token: Address, wallets: readonly Address[]) => Promise<bigint[] | null>;

let cached: PublicClient | undefined;
const client = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

/** The real balances, in one multicall. A wallet whose read fails counts as zero. */
export const viemHoldings: Holdings = async (token, wallets) => {
  if (wallets.length === 0) return [];
  try {
    const results = await client().multicall({
      contracts: wallets.map((wallet) => ({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }) as const),
      allowFailure: true,
    });
    return results.map((r) => (r.status === "success" ? (r.result as bigint) : 0n));
  } catch {
    return null;
  }
};

export type MemberDeps = {
  holdings?: Holdings;
  /** Epoch ms. */
  now?: () => number;
};

const nowOf = (deps: MemberDeps) => deps.now?.() ?? Date.now();

/** The wallets of `userId` that have a shared profile, lowercase. */
export async function sharedWallets(store: Store, userId: string): Promise<Set<string>> {
  const wallets = await store.members(userWalletsKey(userId));
  const rows = await store.getMany<StoredProfile>(wallets.map(profileKey));
  return new Set(wallets.filter((_, i) => rows[i]?.userId === userId));
}

export const getMember = (store: Store, token: string, userId: string) => store.get<MemberRow>(memberKey(token, userId));

/**
 * The row's holder flag as of now: holding any of the Club's assets earns it. The old row comes
 * back when the chain couldn't be read and what it could read doesn't already settle it.
 */
async function checked(entry: ClubEntry, row: MemberRow, deps: MemberDeps): Promise<MemberRow> {
  const read = deps.holdings ?? viemHoldings;
  const results = await Promise.all(
    clubAssets(entry).map(async (asset) => {
      const balances = await read(asset.address, row.wallets as Address[]).catch(() => null);
      return balances && isHolder(asset, balances);
    }),
  );
  if (!results.includes(true) && results.includes(null)) return row;
  return { ...row, holder: results.includes(true), holderCheckedAt: nowOf(deps) };
}

export type JoinResult =
  | { ok: true; row: MemberRow }
  | { ok: false; reason: "archived" | "no_wallet" | "full" | "banned" };

/** Joins `userId` to the Club. Joining twice is the same as once. */
export async function joinClub(
  store: Store,
  entry: ClubEntry,
  userId: string,
  wallets: readonly string[],
  deps: MemberDeps = {},
): Promise<JoinResult> {
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  if (wallets.length === 0) return { ok: false, reason: "no_wallet" };
  if (await isBanned(store, entry.address, userId)) return { ok: false, reason: "banned" };

  const existing = await getMember(store, entry.address, userId);
  if (!existing && (await store.countMembers(membersKey(entry.address))) >= MAX_MEMBERS) return { ok: false, reason: "full" };

  const display = pickDisplayWallet(wallets, await sharedWallets(store, userId))!;
  const base: MemberRow = existing
    ? withWallets(existing, wallets, display)
    : { userId, wallets: wallets.map((w) => w.toLowerCase()), displayWallet: display, holder: false, holderCheckedAt: 0, joinedAt: nowOf(deps) };
  const row = base.holderCheckedAt === 0 ? await checked(entry, base, deps) : base;

  await store.set(memberKey(entry.address, userId), row);
  await store.addMember(membersKey(entry.address), userId);
  await store.addMember(userClubsKey(userId), entry.address.toLowerCase());
  return { ok: true, row };
}

/**
 * Takes `userId` out of the Club, and takes any role with them. Leaving a Club you're not in does
 * nothing. (Whether an Owner may leave is the route's rule: this also runs when a user is banned,
 * deleted or left with no wallet, and then they go regardless.)
 */
export async function leaveClub(store: Store, token: string, userId: string): Promise<void> {
  const roles = await loadRoles(store, token);
  if (roles.owner === userId || roles.moderators.includes(userId)) await saveRoles(store, token, withoutUser(roles, userId));
  await store.del(memberKey(token, userId));
  await store.removeMember(membersKey(token), userId);
  await store.removeMember(userClubsKey(userId), token.toLowerCase());
}

/** The Clubs (lowercase token addresses) this user belongs to. */
export const clubsOf = (store: Store, userId: string) => store.members(userClubsKey(userId));

/**
 * Brings every membership of `userId` in line with their linked wallets (a webhook, a profile
 * re-sync, or a signed-in page load). A user left with no wallet can't hold or score anything and
 * has no wallet to show, so they leave every Club; joining again takes a linked wallet.
 * Idempotent, and based only on `wallets`, like `syncProfile`.
 */
export async function syncMemberships(store: Store, userId: string, wallets: readonly string[]): Promise<void> {
  const tokens = await clubsOf(store, userId);
  if (tokens.length === 0) return;
  if (wallets.length === 0) {
    await Promise.all(tokens.map((token) => leaveClub(store, token, userId)));
    return;
  }
  const display = pickDisplayWallet(wallets, await sharedWallets(store, userId))!;
  await Promise.all(
    tokens.map(async (token) => {
      const row = await getMember(store, token, userId);
      if (!row) return store.removeMember(userClubsKey(userId), token);
      const next = withWallets(row, wallets, display);
      if (next !== row) await store.set(memberKey(token, userId), next);
    }),
  );
}

/** Every member's row. Ids with no row (a half-finished leave) are skipped. */
export async function allRows(store: Store, token: string): Promise<MemberRow[]> {
  const ids = await store.members(membersKey(token));
  const rows = await store.getMany<MemberRow>(ids.map((id) => memberKey(token, id)));
  return rows.filter((row): row is MemberRow => row !== null);
}

/** How many people have joined. Cheap: no rows are read. */
export const memberCount = (store: Store, token: string) => store.countMembers(membersKey(token));

/**
 * The Club's members, ranked. Balances older than a day are re-read first (at most
 * `RECHECK_PER_READ` per call, in one multicall each), so the badge never lags by more than that.
 */
export async function listMembers(
  store: Store,
  entry: ClubEntry,
  events: readonly ActivityEvent[],
  sort: MemberSort,
  nowSec: number,
  deps: MemberDeps = {},
): Promise<MembersView> {
  let rows = await allRows(store, entry.address);
  const stale = staleRows(rows, nowOf(deps));
  if (stale.length > 0) {
    const fresh = new Map((await Promise.all(stale.map((row) => checked(entry, row, deps)))).map((row) => [row.userId, row]));
    await Promise.all(
      [...fresh].filter(([id, row]) => row !== stale.find((s) => s.userId === id)).map(([id, row]) => store.set(memberKey(entry.address, id), row)),
    );
    rows = rows.map((row) => fresh.get(row.userId) ?? row);
  }
  const scores = score(
    events.map((e) => ({ kind: e.kind, at: e.at, parties: e.parties })),
    nowSec,
  );
  return rankMembers(rows, scores, events, sort, await loadRoles(store, entry.address));
}

/** How many members hold the asset, as of their last check. Reads every row. */
export async function holderCount(store: Store, token: string): Promise<number> {
  return (await allRows(store, token)).filter((row) => row.holder).length;
}
