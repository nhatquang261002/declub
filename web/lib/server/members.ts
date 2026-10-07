import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";
import { chain } from "../chain";
import { CHAIN_ID, RPC_URL } from "../config";
import { toScored, type ActivityEvent } from "../clubs";
import {
  MAX_MEMBERS,
  RECHECK_PER_READ,
  coinRule,
  isHolder,
  pickDisplayWallet,
  rankMembers,
  staleRows,
  withWallets,
  type MemberRow,
  type MemberSort,
  type CoinRule,
  type MembersPaging,
  type MembersView,
} from "../members";
import { score } from "../momentum";
import { profileKey, userWalletsKey, type StoredProfile } from "../profiles";
import { clubAssets, type ClubEntry } from "../verifiedAssets";
import { withoutUser } from "../clubRoles";
import { epochAt } from "../rewards";
import { isBanned, loadProfile, loadRoles, saveRoles } from "./clubState";
import { liveStreak, readStreaks } from "./streaks";
import type { Store } from "./store";

/**
 * Club membership in the store (ADR 0016, docs/09-clubs.md). A member is a Privy user, kept by
 * user id; their wallets are copied from Privy's linked accounts, never from a request. The Holder
 * badge is a balance read on the server and is usually out of date by less than a day (see `listMembers`).
 */

export const membersKey = (token: string) => `declub:club:${CHAIN_ID}:${token.toLowerCase()}:members`;
export const memberKey = (token: string, userId: string) => `declub:club-member:${CHAIN_ID}:${token.toLowerCase()}:${userId}`;
export const userClubsKey = (userId: string) => `declub:user-clubs:${userId}`;
/**
 * The memberships shown under a wallet (ADR 0042), as `token:userId`. Only a member's display wallet
 * is indexed, the one the Members list already shows, so a profile says no more than the Clubs do:
 * their other linked wallets are not tied to them here.
 */
export const walletMembershipsKey = (wallet: string) => `declub:wallet-clubs:${CHAIN_ID}:${wallet.toLowerCase()}`;

/** Moves a membership's entry from the wallet it was shown under to the one it is shown under now. Idempotent. */
async function reindex(store: Store, token: string, userId: string, from: string | undefined, to: string | undefined) {
  const entry = `${token.toLowerCase()}:${userId}`;
  if (from && from.toLowerCase() !== to?.toLowerCase()) await store.removeMember(walletMembershipsKey(from), entry);
  if (to) await store.addMember(walletMembershipsKey(to), entry);
}

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
 * The Club's Holder rule for its memecoin, and when it last changed (epoch ms, 0 when never), or
 * null for a Club without one.
 */
async function coinRuleOf(store: Store, entry: ClubEntry): Promise<{ rule: CoinRule; since: number } | null> {
  if (!entry.linked) return null;
  const { coinHolders } = await loadProfile(store, entry.address);
  return { rule: coinRule(entry.linked, coinHolders), since: coinHolders?.at ?? 0 };
}

/**
 * The row's holder flag as of now: holding any NFT of the collection earns it, and so does enough
 * of its memecoin when the Club counts it. The old row comes back when the chain couldn't be read
 * and what it could read doesn't already settle it.
 */
async function checked(entry: ClubEntry, row: MemberRow, deps: MemberDeps, coin: CoinRule | undefined): Promise<MemberRow> {
  const read = deps.holdings ?? viemHoldings;
  const counted = clubAssets(entry).filter((asset) => asset.kind === "erc721" || coin?.on !== false);
  const results = await Promise.all(
    counted.map(async (asset) => {
      const balances = await read(asset.address, row.wallets as Address[]).catch(() => null);
      return balances && isHolder(asset, balances, asset.kind === "erc20" ? coin : undefined);
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
  const row = base.holderCheckedAt === 0 ? await checked(entry, base, deps, (await coinRuleOf(store, entry))?.rule) : base;

  await store.set(memberKey(entry.address, userId), row);
  await store.addMember(membersKey(entry.address), userId);
  await store.addMember(userClubsKey(userId), entry.address.toLowerCase());
  await reindex(store, entry.address, userId, existing?.displayWallet, row.displayWallet);
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
  const row = await getMember(store, token, userId);
  await store.del(memberKey(token, userId));
  await store.removeMember(membersKey(token), userId);
  await reindex(store, token, userId, row?.displayWallet, undefined);
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
      // Also fills in memberships made before the index existed, the next time their owner is read.
      await reindex(store, token, userId, row.displayWallet, next.displayWallet);
    }),
  );
}

/** A wallet's memberships as the Members lists show them: the Clubs it is listed in, with the member's row. */
export async function membershipsOfWallet(store: Store, wallet: string): Promise<{ token: string; row: MemberRow }[]> {
  const entries = (await store.members(walletMembershipsKey(wallet))).flatMap((entry) => {
    const at = entry.indexOf(":");
    return at > 0 ? [{ token: entry.slice(0, at), userId: entry.slice(at + 1) }] : [];
  });
  const rows = await store.getMany<MemberRow>(entries.map((e) => memberKey(e.token, e.userId)));
  // The index can lag a change by a moment; only a row that still shows this wallet counts.
  return entries.flatMap((e, i) => (rows[i]?.displayWallet === wallet.toLowerCase() ? [{ token: e.token, row: rows[i]! }] : []));
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
 * `RECHECK_PER_READ` per call, in one multicall each), so the badge usually lags by less than a day; a big or unread Club can lag longer.
 */
export async function listMembers(
  store: Store,
  entry: ClubEntry,
  events: readonly ActivityEvent[],
  sort: MemberSort,
  nowSec: number,
  deps: MemberDeps = {},
  paging?: MembersPaging,
): Promise<MembersView> {
  let rows = await allRows(store, entry.address);
  const coin = await coinRuleOf(store, entry);
  const stale = staleRows(rows, nowOf(deps), RECHECK_PER_READ, coin?.since);
  if (stale.length > 0) {
    const fresh = new Map((await Promise.all(stale.map((row) => checked(entry, row, deps, coin?.rule)))).map((row) => [row.userId, row]));
    await Promise.all(
      [...fresh].filter(([id, row]) => row !== stale.find((s) => s.userId === id)).map(([id, row]) => store.set(memberKey(entry.address, id), row)),
    );
    rows = rows.map((row) => fresh.get(row.userId) ?? row);
  }
  // `toScored` keeps an X share's weight, so a weak one counts half here too, as in the lenses.
  const scores = score(events.map(toScored), nowSec);
  const current = epochAt(nowSec);
  const recorded = await readStreaks(store, entry.address);
  const streaks = new Map(rows.map((row) => [row.userId, liveStreak(recorded[row.userId], current)]));
  // Handles are read only for a search: they live in the profile store, one lookup per member.
  let handles: Map<string, string> | undefined;
  if (paging?.query?.trim()) {
    const profiles = await store.getMany<StoredProfile>(rows.map((row) => profileKey(row.displayWallet)));
    handles = new Map();
    rows.forEach((row, i) => {
      const profile = profiles[i];
      if (profile && profile.userId === row.userId) handles!.set(row.displayWallet, profile.handle);
    });
  }
  return rankMembers(rows, scores, events, sort, await loadRoles(store, entry.address), streaks, paging && { ...paging, handles });
}

/** How many members hold the asset, as of their last check. Reads every row. */
export async function holderCount(store: Store, token: string): Promise<number> {
  return (await allRows(store, token)).filter((row) => row.holder).length;
}
