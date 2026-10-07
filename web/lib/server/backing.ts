import { keccak256, toBytes } from "viem";
import type { StoredPost } from "../clubPosts";
import { CHAIN_ID } from "../config";
import { profileKey, userWalletsKey, type StoredProfile } from "../profiles";
import { DEFAULT_CLUB_RULES, PROTOCOL, backingWeight, epochAt, voiceOf, type BackingAction, type ClubRules, type Voice } from "../rewards";
import { dayOf } from "./activeDays";
import { likesKey, postKey, repliesKey } from "./board";
import type { Store } from "./store";

/**
 * Backing (ADR 0038): every like and reply a member gives in a Club is recorded against the epoch
 * it was given in, with its UTC day. Reading checks it is still there: a like taken back, a deleted
 * post or reply, and a post or reply a moderator hid, or one under a post a moderator hid, count for
 * nothing (ADR 0040). Reports alone don't remove anything. What is left is each
 * giver's actions, for `backingPoints`, and the days they gave on, for active days. Each giver's
 * actions are also indexed across Clubs, so a base voice can be shared over all of them (ADR 0039).
 */

/** The likes and replies given in a Club's epoch `n`, as `kind|day|postId|userId`. */
export const backingKey = (club: string, n: number) => `declub:backing:${CHAIN_ID}:${club.toLowerCase()}:${n}`;
/** Everything `userId` gave in epoch `n`, in every Club, as `club|kind|day|postId`. */
export const givenKey = (n: number, userId: string) => `declub:backing-by:${CHAIN_ID}:${n}:${userId}`;

/** Records a like (of post `id`) or a reply (`id` is the reply) by `userId`. `at` is epoch ms, as posts keep it. */
export async function recordBacking(
  store: Store,
  club: string,
  entry: { kind: "like" | "reply"; id: string; userId: string; at: number },
  genesis?: number,
  length?: number,
): Promise<void> {
  const seconds = Math.floor(entry.at / 1000);
  const n = epochAt(seconds, genesis, length);
  if (n < 0) return;
  // The user id is a Privy DID (`did:privy:…`) with colons, so the fields are split by `|`, and it goes last.
  await store.addMember(backingKey(club, n), `${entry.kind}|${dayOf(seconds)}|${entry.id}|${entry.userId}`);
  await store.addMember(givenKey(n, entry.userId), `${club.toLowerCase()}|${entry.kind}|${dayOf(seconds)}|${entry.id}`);
}

type Entry = { kind: "like" | "reply"; day: string; id: string; userId: string };

/**
 * Whether a post's backing counts for nothing (ADR 0040): only a moderator's hide removes points. A
 * post that members' reports hid (before ADR 0040 they could) still counts until staff act on it.
 */
export const removedForRewards = (post: Pick<StoredPost, "hidden">) => post.hidden === "moderator";

export type EpochBacking = {
  /** One per like (per post and giver) and per reply that still stands. */
  actions: BackingAction[];
  /** What a moderator's hide took out: published, so the loss can be matched to the moderation log (ADR 0040). */
  removed: BackingAction[];
  /** By user id: the UTC days they liked or replied on. */
  days: Map<string, Set<string>>;
};

export async function readBacking(store: Store, club: string, n: number): Promise<EpochBacking> {
  const entries = (await store.members(backingKey(club, n))).flatMap((m): Entry[] => {
    const [kind, day, id, ...rest] = m.split("|");
    const userId = rest.join("|");
    return (kind === "like" || kind === "reply") && day && id && userId ? [{ kind, day, id, userId }] : [];
  });
  return standing(store, club, entries);
}

/** The entries that still stand in one Club, as actions and days. */
async function standing(store: Store, club: string, entries: Entry[]): Promise<EpochBacking> {
  if (entries.length === 0) return { actions: [], removed: [], days: new Map() };

  const posts = await load(store, club, [...new Set(entries.map((e) => e.id))]);
  // The posts the replies answer, and the replies liked: their parents decide whether they still show.
  const parents = await load(store, club, [...new Set([...posts.values()].flatMap((p) => (p.parent ? [p.parent] : [])))]);
  const likeIds = [...new Set(entries.filter((e) => e.kind === "like").map((e) => e.id))];
  const likers = new Map(await Promise.all(likeIds.map(async (id) => [id, new Set(await store.members(likesKey(club, id)))] as const)));
  const firsts = await firstReplies(store, club, [...parents.values()]);

  const actions: BackingAction[] = [];
  const removed: BackingAction[] = [];
  const seen = new Set<string>();
  const days = new Map<string, Set<string>>();
  // Earliest day first, so a post liked again on a later day is still one like, on its first day.
  const ordered = [...entries].sort((x, y) => (x.day === y.day ? 0 : Number(x.day) - Number(y.day)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const e of ordered) {
    const post = posts.get(e.id);
    if (!post) continue;
    const parent = post.parent ? parents.get(post.parent) : undefined;
    if (post.parent && !parent) continue;
    let action: BackingAction;
    if (e.kind === "like") {
      if (post.userId === e.userId || !likers.get(e.id)?.has(e.userId)) continue;
      action = { giver: e.userId, receiver: post.userId, kind: "like" };
    } else {
      if (!parent || post.userId !== e.userId) continue;
      action = { giver: e.userId, receiver: parent.userId, kind: firsts.get(parent.id) === post.id ? "first" : "reply" };
    }
    const key = `${e.kind}|${e.id}|${e.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (removedForRewards(post) || (parent && removedForRewards(parent))) {
      removed.push(action);
      continue;
    }
    days.set(e.userId, (days.get(e.userId) ?? new Set()).add(e.day));
    actions.push(action);
  }
  return { actions, removed, days };
}

async function load(store: Store, club: string, ids: string[]): Promise<Map<string, StoredPost>> {
  const rows = await store.getMany<StoredPost>(ids.map((id) => postKey(club, id)));
  return new Map(rows.flatMap((p) => (p ? [[p.id, p] as const] : [])));
}

/** Each post's first visible reply from someone other than its author, by post id. */
async function firstReplies(store: Store, club: string, parents: StoredPost[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const parent of parents) {
    const replies = [...(await load(store, club, await store.members(repliesKey(club, parent.id)))).values()];
    const first = replies.filter((r) => !removedForRewards(r) && r.userId !== parent.userId).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))[0];
    if (first) out.set(parent.id, first.id);
  }
  return out;
}

/** The total weight of what `userId` gave in epoch `n` in every Club, counting only what still stands. */
export async function givenEverywhere(store: Store, n: number, userId: string, rules: ClubRules = DEFAULT_CLUB_RULES): Promise<number> {
  const byClub = new Map<string, Entry[]>();
  for (const m of await store.members(givenKey(n, userId))) {
    const [club, kind, day, id] = m.split("|");
    if (!club || (kind !== "like" && kind !== "reply") || !day || !id) continue;
    byClub.set(club, [...(byClub.get(club) ?? []), { kind, day, id, userId }]);
  }
  let total = 0;
  for (const [club, entries] of byClub) {
    for (const a of (await standing(store, club, entries)).actions) if (a.giver !== a.receiver) total += backingWeight(a.kind, rules);
  }
  return total;
}

/** When `userId` started sharing a verified profile (epoch ms), or null when they share none. */
export async function verifiedSince(store: Store, userId: string): Promise<number | null> {
  const wallets = await store.members(userWalletsKey(userId));
  const rows = (await store.getMany<StoredProfile>(wallets.map(profileKey))).filter((r): r is StoredProfile => r?.userId === userId);
  return rows.length === 0 ? null : Math.min(...rows.map((r) => r.since ?? r.updatedAt));
}

/**
 * Each giver's voices for one Club's epoch (ADR 0039): their NFT voice from `held`, the NFTs they
 * held on average over the epoch (Holders of this Club only; ADR 0040), and the base voice if they
 * shared a verified profile by `linkedBy` (epoch ms), with the weight they gave everywhere to share it over.
 */
export async function voicesFor(
  store: Store,
  n: number,
  givers: Iterable<string>,
  held: ReadonlyMap<string, number | bigint>,
  linkedBy: number,
  rules: ClubRules = DEFAULT_CLUB_RULES,
): Promise<Map<string, Voice>> {
  const out = new Map<string, Voice>();
  for (const userId of new Set(givers)) {
    const since = await verifiedSince(store, userId);
    const verified = since !== null && since <= linkedBy;
    out.set(userId, {
      club: voiceOf(held.get(userId) ?? 0, rules),
      base: verified ? PROTOCOL.baseVoice : 0,
      ...(verified ? { given: await givenEverywhere(store, n, userId, rules) } : {}),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── published backing

/** One Club's backing in an epoch, by public wallet, so anyone can recompute its points with `backingPoints` (ADR 0040). */
export type PublishedBacking = {
  voices: Record<string, Voice>;
  actions: { from: string; to: string; kind: BackingAction["kind"] }[];
  removed: { from: string; to: string; kind: BackingAction["kind"]; by: "moderator" }[];
};

/** Epoch `n`'s published backing, by Club. Kept apart from the epoch record so that stays small. */
export const backingRecordKey = (n: number) => `declub:rewards:${CHAIN_ID}:backing:${n}`;

/**
 * A user's public wallet: their Club wallet when they're a member (`members`), else the first wallet
 * of their shared profile. With neither, a stable label from a hash of their id, which shows nobody's.
 */
export async function publicWallet(store: Store, userId: string, members: ReadonlyMap<string, string>): Promise<string> {
  const known = members.get(userId);
  if (known) return known.toLowerCase();
  const wallets = (await store.members(userWalletsKey(userId))).sort();
  return wallets[0]?.toLowerCase() ?? `unknown:${keccak256(toBytes(userId)).slice(2, 12)}`;
}

/** Publishes one Club's epoch backing: who gave whom what, the voices they gave it with, and what a moderator's hide removed. */
export async function publishBacking(
  store: Store,
  backing: { actions: readonly BackingAction[]; removed: readonly BackingAction[] },
  voices: ReadonlyMap<string, Voice>,
  members: ReadonlyMap<string, string>,
): Promise<PublishedBacking> {
  const names = new Map<string, string>();
  const nameOf = async (userId: string) => {
    if (!names.has(userId)) names.set(userId, await publicWallet(store, userId, members));
    return names.get(userId)!;
  };
  const out: PublishedBacking = { voices: {}, actions: [], removed: [] };
  for (const [userId, voice] of voices) out.voices[await nameOf(userId)] = voice;
  for (const a of backing.actions) out.actions.push({ from: await nameOf(a.giver), to: await nameOf(a.receiver), kind: a.kind });
  for (const a of backing.removed) out.removed.push({ from: await nameOf(a.giver), to: await nameOf(a.receiver), kind: a.kind, by: "moderator" });
  return out;
}
