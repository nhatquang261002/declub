import { randomUUID } from "node:crypto";
import {
  CHALLENGE_RULES,
  checkChallenge,
  isLive,
  phaseOf,
  winnersByLikes,
  winnersByPick,
  xEntryProblem,
  type Candidate,
  type PublicChallenge,
  type PublicEntry,
  type Settlement,
  type StoredChallenge,
  type Winner,
} from "../challenges";
import type { StoredPost, StoredXCard } from "../clubPosts";
import { isOwnerOrAdmin } from "../clubRoles";
import { epochAt, epochWindow } from "../rewards";
import type { AssetEntry } from "../verifiedAssets";
import { getPost, likesKey, postKey, roleIn, type Actor, type Deps } from "./board";
import { ALL, appendLog, loadBans } from "./clubState";
import { awardsKey, challengeKey, challengesKey, entriesKey, entryOfKey, readAwards, settleLockKey } from "./challengeState";
import { rewardBans } from "./clubRules";
import { allRows, freshHolder, getMember, type MemberDeps } from "./members";
import { closingKey } from "./rewards";
import type { Store } from "./store";

/**
 * Club challenges (ADR 0045): the Owner sets a task, members answer with a Board post, and the winners
 * earn activity points in the epoch it ends in. Every function takes the store and the Club, so the
 * rules run against an in-memory store in tests; each refusal is a reason code the routes map to a
 * status and a sentence.
 */

const nowOf = (deps: Pick<Deps, "now">) => deps.now?.() ?? Date.now();
const toEpoch = (ms: number, deps: Pick<Deps, "epochs">) => Math.max(0, epochAt(Math.floor(ms / 1000), deps.epochs?.genesis, deps.epochs?.length));

export type ChallengeRefusal =
  | "archived" | "forbidden" | "not_found" | "invalid" | "not_member" | "banned" | "reward_banned" | "closed"
  | "holders_only" | "too_many_open" | "owner_entry" | "bad_post" | "not_x" | "x_not_own" | "x_too_old" | "already_entered" | "full" | "not_judging" | "no_entry" | "busy";

async function load(store: Store, token: string, id: string) {
  return /^[0-9a-f-]{36}$/.test(id) ? store.get<StoredChallenge>(challengeKey(token, id)) : null;
}

const entriesOf = async (store: Store, token: string, id: string) =>
  (await store.members(entriesKey(token, id))).flatMap((m) => {
    const at = m.indexOf("|");
    return at > 0 ? [{ post: m.slice(0, at), userId: m.slice(at + 1) }] : [];
  });

/** The Owner (or an app admin) starts a challenge that runs from now. */
export async function createChallenge(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  input: unknown,
  deps: Deps = {},
): Promise<{ ok: true; id: string } | { ok: false; reason: ChallengeRefusal; message?: string }> {
  const token = entry.address.toLowerCase();
  if (!isOwnerOrAdmin(await roleIn(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const checked = checkChallenge(input);
  if (!checked.ok) return { ok: false, reason: "invalid", message: checked.message };
  const now = nowOf(deps);
  const ids = await store.ranked(challengesKey(token), CHALLENGE_RULES.kept);
  const all = await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(token, id)));
  const open = all.filter((c): c is StoredChallenge => !!c && phaseOf(c, now) === "open");
  if (open.length >= CHALLENGE_RULES.maxOpen) return { ok: false, reason: "too_many_open" };

  // It ends when an epoch does, so its points count in that epoch (ADR 0045).
  const { epochs, ...rest } = checked.challenge;
  const g = deps.epochs?.genesis;
  const l = deps.epochs?.length;
  const endsAt = epochWindow(toEpoch(now, deps) + epochs - 1, g, l).end * 1000;
  if (endsAt - now < CHALLENGE_RULES.minHours * 3_600_000) {
    return { ok: false, reason: "invalid", message: "Less than an hour is left in this epoch: let it run to the end of the next one." };
  }
  const id = randomUUID();
  const challenge: StoredChallenge = { id, ...rest, startsAt: now, endsAt, by: actor.wallet, state: "live" };
  await store.set(challengeKey(token, id), challenge);
  await store.rank(challengesKey(token), [{ member: id, score: now }], CHALLENGE_RULES.kept);
  await appendLog(store, token, { actor: actor.wallet, action: "create_challenge", target: id, detail: `${challenge.title} · ${challenge.prizes.join("/")} points · judged by ${challenge.judging}${challenge.holdersOnly ? " · Holders only" : ""}` }, now);
  return { ok: true, id };
}

/** The Owner cancels a challenge that hasn't been settled: nobody earns anything from it. */
export async function cancelChallenge(store: Store, entry: AssetEntry, actor: Actor, id: string, deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: ChallengeRefusal }> {
  const token = entry.address.toLowerCase();
  if (!isOwnerOrAdmin(await roleIn(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  const c = await load(store, token, id);
  if (!c) return { ok: false, reason: "not_found" };
  if (c.state !== "live") return { ok: false, reason: "closed" };
  await store.set(challengeKey(token, id), { ...c, state: "cancelled" } satisfies StoredChallenge);
  await appendLog(store, token, { actor: actor.wallet, action: "cancel_challenge", target: id, detail: c.title }, nowOf(deps));
  return { ok: true };
}

/** The entries that can win, with their likes, now. A post that's gone or hidden, or a member who left, was banned or banned from rewards, drops out. */
async function candidates(store: Store, token: string, c: StoredChallenge): Promise<(Candidate & { text: string; x?: StoredXCard; likers: string[] })[]> {
  const entries = await entriesOf(store, token, c.id);
  const posts = await store.getMany<StoredPost>(entries.map((e) => postKey(token, e.post)));
  const rows = new Map((await allRows(store, token)).map((r) => [r.userId, r]));
  const banned = new Set([...Object.keys(await loadBans(store, token)), ...Object.keys(await loadBans(store, ALL))]);
  const noRewards = new Set(Object.keys(await rewardBans(store, token)));
  const out: (Candidate & { text: string; x?: StoredXCard; likers: string[] })[] = [];
  for (const [i, e] of entries.entries()) {
    const post = posts[i];
    const row = rows.get(e.userId);
    if (!post || post.userId !== e.userId || post.parent || post.hidden || !row?.displayWallet || banned.has(e.userId) || noRewards.has(e.userId)) continue;
    const likers = (await store.members(likesKey(token, e.post))).filter((u) => u !== e.userId && rows.has(u) && !noRewards.has(u));
    out.push({ post: e.post, userId: e.userId, wallet: row.displayWallet, at: post.at, likes: likers.length, text: post.text, ...(post.x ? { x: post.x } : {}), likers });
  }
  return out;
}

/** Writes a settlement: the points go to the epoch they count in, then the challenge is marked settled. Safe to repeat. */
async function finish(store: Store, token: string, c: StoredChallenge, winners: Winner[], userOf: ReadonlyMap<string, string>, at: number, epoch: number, by: string, expired = false) {
  if (winners.length > 0) {
    const awards = await readAwards(store, token, epoch);
    for (const w of winners) {
      const userId = userOf.get(w.post)!;
      const award = awards[userId] ?? { userId, wallet: w.wallet, points: 0, wins: [] };
      // Replacing this challenge's win keeps a repeated settle from paying twice.
      award.wins = [...award.wins.filter((x) => x.challenge !== c.id), { challenge: c.id, title: c.title, place: w.place, points: w.points }];
      award.points = award.wins.reduce((sum, x) => sum + x.points, 0);
      award.wallet = w.wallet;
      awards[userId] = award;
    }
    await store.set(awardsKey(token, epoch), awards);
  }
  const settlement: Settlement = { at, ...(winners.length > 0 ? { epoch } : {}), winners, ...(expired ? { expired: true as const } : {}) };
  await store.set(challengeKey(token, c.id), { ...c, state: "settled", settled: settlement } satisfies StoredChallenge);
  await appendLog(
    store,
    token,
    { actor: by, action: "settle_challenge", target: c.id, detail: `${c.title} · ${winners.length > 0 ? winners.map((w) => `${w.place}. ${w.wallet} +${w.points}`).join(", ") : expired ? "no pick in time" : "no winner"}` },
    at,
  );
}

/** The epoch a settlement's points count in: the one a likes-judged challenge ended in, if it isn't closed yet, else the running one. */
async function awardEpoch(store: Store, token: string, c: StoredChallenge, now: number, deps: Pick<Deps, "epochs">) {
  if (c.judging === "likes") {
    // `endsAt` is the first instant of the next epoch: it ended in the one before.
    const ended = toEpoch(c.endsAt - 1, deps);
    if (!(await store.get(closingKey(token, ended)))) return ended;
  }
  return toEpoch(now, deps);
}

/**
 * Settles the Club's challenges that have ended: a likes-judged one picks its winners from the likes
 * it has (they're locked from the end, see `votingClosed`); an Owner-judged one that wasn't picked
 * in time expires with none. Called when challenges are read and by the epoch close, so a finished
 * challenge's points are in before its epoch is frozen. Returns how many it settled.
 */
export async function settleDue(store: Store, entry: AssetEntry, deps: Pick<Deps, "now" | "epochs"> = {}): Promise<number> {
  const token = entry.address.toLowerCase();
  const now = nowOf(deps);
  const ids = await store.ranked(challengesKey(token), CHALLENGE_RULES.kept);
  let settled = 0;
  for (const id of ids) {
    const c = await load(store, token, id);
    if (!c || c.state !== "live" || now < c.endsAt) continue;
    const expired = c.judging === "owner";
    if (expired && now < c.endsAt + CHALLENGE_RULES.pickWindowMs) continue;
    if ((await store.hit(settleLockKey(token, id), 30)) > 1) continue;
    try {
      // Read again under the lock: another request may have settled it.
      const fresh = await load(store, token, id);
      if (!fresh || fresh.state !== "live") continue;
      if (expired) {
        await finish(store, token, fresh, [], new Map(), now, toEpoch(now, deps), fresh.by, true);
      } else {
        const cands = await candidates(store, token, fresh);
        await finish(store, token, fresh, winnersByLikes(cands, fresh.prizes), new Map(cands.map((x) => [x.post, x.userId])), now, await awardEpoch(store, token, fresh, now, deps), fresh.by);
      }
      settled++;
    } finally {
      await store.del(settleLockKey(token, id));
    }
  }
  return settled;
}

/** A member puts one of their Board posts into an open challenge. One entry each: a new one replaces the old. */
export async function enterChallenge(
  store: Store,
  entry: AssetEntry,
  userId: string,
  id: string,
  postId: unknown,
  deps: Deps & MemberDeps = {},
): Promise<{ ok: true } | { ok: false; reason: ChallengeRefusal }> {
  const token = entry.address.toLowerCase();
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const c = await load(store, token, id);
  if (!c) return { ok: false, reason: "not_found" };
  const now = nowOf(deps);
  if (phaseOf(c, now) !== "open") return { ok: false, reason: "closed" };
  // For Holders only, the badge is read fresh: an NFT bought a minute ago counts, one sold doesn't.
  const row = c.holdersOnly ? await freshHolder(store, entry, userId, deps) : await getMember(store, token, userId);
  if (!row) return { ok: false, reason: "not_member" };
  if (c.holdersOnly && !row.holder) return { ok: false, reason: "holders_only" };
  const [here, everywhere] = await Promise.all([loadBans(store, token), loadBans(store, ALL)]);
  if (userId in here || userId in everywhere) return { ok: false, reason: "banned" };
  if (userId in (await rewardBans(store, token))) return { ok: false, reason: "reward_banned" };
  // The Owner sets the task and may pick the winners: they, and an app admin, don't compete.
  if (isOwnerOrAdmin(await roleIn(store, token, userId, deps))) return { ok: false, reason: "owner_entry" };
  if (typeof postId !== "string") return { ok: false, reason: "bad_post" };
  const post = await getPost(store, token, postId);
  if (!post || post.userId !== userId || post.parent || post.hidden || post.at < c.startsAt || post.at >= c.endsAt) return { ok: false, reason: "bad_post" };
  const notX = xEntryProblem(post, c);
  if (notX) return { ok: false, reason: notX };
  const elsewhere = await store.get<string>(entryOfKey(token, postId));
  if (elsewhere && elsewhere !== id) return { ok: false, reason: "already_entered" };

  const entries = await entriesOf(store, token, id);
  const mine = entries.find((e) => e.userId === userId);
  if (mine?.post === postId) return { ok: true };
  if (!mine && entries.length >= CHALLENGE_RULES.maxEntries) return { ok: false, reason: "full" };
  if (mine) {
    await store.removeMember(entriesKey(token, id), `${mine.post}|${userId}`);
    await store.del(entryOfKey(token, mine.post));
  }
  await store.addMember(entriesKey(token, id), `${postId}|${userId}`);
  await store.set(entryOfKey(token, postId), id);
  return { ok: true };
}

/** A member takes their entry back while the challenge is open. */
export async function withdrawEntry(store: Store, entry: AssetEntry, userId: string, id: string, deps: Deps = {}): Promise<{ ok: true } | { ok: false; reason: ChallengeRefusal }> {
  const token = entry.address.toLowerCase();
  const c = await load(store, token, id);
  if (!c) return { ok: false, reason: "not_found" };
  if (phaseOf(c, nowOf(deps)) !== "open") return { ok: false, reason: "closed" };
  const mine = (await entriesOf(store, token, id)).find((e) => e.userId === userId);
  if (!mine) return { ok: false, reason: "no_entry" };
  await store.removeMember(entriesKey(token, id), `${mine.post}|${userId}`);
  await store.del(entryOfKey(token, mine.post));
  return { ok: true };
}

/**
 * The Owner picks the winners of a challenge they judge, best first, once it has ended and within
 * `pickWindowMs`. The points count in the epoch running now.
 */
export async function pickWinners(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  id: string,
  picked: unknown,
  deps: Deps = {},
): Promise<{ ok: true; winners: Winner[] } | { ok: false; reason: ChallengeRefusal; message?: string }> {
  const token = entry.address.toLowerCase();
  if (!isOwnerOrAdmin(await roleIn(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  const c = await load(store, token, id);
  if (!c) return { ok: false, reason: "not_found" };
  const now = nowOf(deps);
  if (c.judging !== "owner" || phaseOf(c, now) !== "judging" || now >= c.endsAt + CHALLENGE_RULES.pickWindowMs) return { ok: false, reason: "not_judging" };
  if (!Array.isArray(picked) || picked.some((p) => typeof p !== "string")) return { ok: false, reason: "invalid", message: "Send the post ids of the winners, best first." };
  if ((await store.hit(settleLockKey(token, id), 30)) > 1) return { ok: false, reason: "busy" };
  try {
    const fresh = await load(store, token, id);
    if (!fresh || fresh.state !== "live") return { ok: false, reason: "closed" };
    const cands = await candidates(store, token, fresh);
    const result = winnersByPick(picked as string[], cands, fresh.prizes);
    if (!result.ok) return { ok: false, reason: "invalid", message: result.message };
    await finish(store, token, fresh, result.winners, new Map(cands.map((x) => [x.post, x.userId])), now, toEpoch(now, deps), actor.wallet);
    return { ok: true, winners: result.winners };
  } finally {
    await store.del(settleLockKey(token, id));
  }
}

/** One challenge as `viewer` sees it, with its entries. */
async function viewOf(store: Store, token: string, c: StoredChallenge, viewer: { userId?: string }, now: number): Promise<PublicChallenge> {
  const phase = phaseOf(c, now);
  const winnerPlace = new Map((c.settled?.winners ?? []).map((w) => [w.post, w.place]));
  let entries: PublicEntry[] = [];
  let mine: string | undefined;
  let entryCount = 0;
  if (phase !== "cancelled") {
    const all = await entriesOf(store, token, c.id);
    entryCount = all.length;
    mine = all.find((e) => e.userId === viewer.userId)?.post;
    const cands = await candidates(store, token, c);
    entries = cands
      .map((x): PublicEntry => ({ post: x.post, wallet: x.wallet, at: x.at, likes: x.likes, liked: !!viewer.userId && x.likers.includes(viewer.userId), mine: x.userId === viewer.userId, text: x.text, ...(x.x ? { x: x.x } : {}), ...(winnerPlace.has(x.post) ? { place: winnerPlace.get(x.post)! } : {}) }))
      .sort((a, b) => (winnerPlace.get(a.post) ?? 99) - (winnerPlace.get(b.post) ?? 99) || b.likes - a.likes || a.at - b.at);
  }
  return {
    id: c.id,
    title: c.title,
    brief: c.brief,
    judging: c.judging,
    prizes: c.prizes,
    holdersOnly: c.holdersOnly === true,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    by: c.by,
    phase,
    ...(c.judging === "owner" && phase === "judging" ? { pickBy: c.endsAt + CHALLENGE_RULES.pickWindowMs } : {}),
    entries,
    entryCount,
    ...(c.settled ? { settled: c.settled } : {}),
    ...(mine ? { mine } : {}),
  };
}

/** One challenge with its entries, settling it first if it has ended; null when the Club has no such challenge. */
export async function getChallenge(store: Store, entry: AssetEntry, id: string, viewer: { userId?: string }, deps: Deps = {}): Promise<PublicChallenge | null> {
  const token = entry.address.toLowerCase();
  await settleDue(store, entry, deps);
  const c = await load(store, token, id);
  return c ? viewOf(store, token, c, viewer, nowOf(deps)) : null;
}

/**
 * The Club's challenges as `userId` sees them: open ones first (soonest end first), then those
 * being judged or settled, newest first. Settles what has ended first.
 */
export async function listChallenges(store: Store, entry: AssetEntry, viewer: { userId?: string }, deps: Deps = {}): Promise<PublicChallenge[]> {
  const token = entry.address.toLowerCase();
  const now = nowOf(deps);
  await settleDue(store, entry, deps);
  const ids = await store.ranked(challengesKey(token), 30);
  const stored = (await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(token, id)))).filter((c): c is StoredChallenge => !!c);
  const out = await Promise.all(stored.map((c) => viewOf(store, token, c, viewer, now)));
  return out.sort(byStanding);
}

const rank = (p: PublicChallenge) => (p.phase === "open" ? 0 : p.phase === "judging" || p.phase === "closing" ? 1 : 2);
/** Open ones first (soonest end first), then those being judged or settled, newest first. */
const byStanding = (a: PublicChallenge, b: PublicChallenge) => rank(a) - rank(b) || (a.phase === "open" ? a.endsAt - b.endsAt : b.startsAt - a.startsAt);

/**
 * The challenges still running or waiting on their result in `clubs`, each with its Club, for the
 * timeline to pin on top. Only a Club with one that has ended is settled first, so reading every
 * Club stays cheap.
 */
export async function liveChallenges(
  store: Store,
  clubs: readonly AssetEntry[],
  viewer: { userId?: string },
  deps: Deps = {},
): Promise<{ club: string; challenge: PublicChallenge }[]> {
  const now = nowOf(deps);
  const lists = await Promise.all(
    clubs.map(async (entry) => {
      const token = entry.address.toLowerCase();
      const read = async () => {
        const ids = await store.ranked(challengesKey(token), 30);
        return (await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(token, id)))).filter((c): c is StoredChallenge => !!c && isLive(phaseOf(c, now)));
      };
      let live = await read();
      if (live.some((c) => now >= c.endsAt) && (await settleDue(store, entry, deps)) > 0) live = await read();
      return Promise.all(live.map(async (c) => ({ club: token, challenge: await viewOf(store, token, c, viewer, now) })));
    }),
  );
  return lists.flat().sort((a, b) => byStanding(a.challenge, b.challenge));
}
