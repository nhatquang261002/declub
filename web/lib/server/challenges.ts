import { randomUUID } from "node:crypto";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { chain } from "../chain";
import { isAddress, type Address } from "viem";
import {
  CHALLENGE_RULES,
  assetFor,
  assetText,
  checkChallenge,
  drawSeed,
  drawWinners,
  isFlat,
  isLive,
  phaseOf,
  prizeOverdue,
  trophyPlace,
  winnersByLikes,
  winnersByPick,
  winnersByTime,
  xEntryProblem,
  type Candidate,
  type Draw,
  type Phase,
  type PublicChallenge,
  type PublicEntry,
  type Settlement,
  type StoredChallenge,
  type Winner,
} from "../challenges";
import { RPC_URL } from "../config";
import type { StoredPost, StoredXCard } from "../clubPosts";
import { isOwnerOrAdmin } from "../clubRoles";
import { epochAt, epochWindow } from "../rewards";
import { registry as defaultRegistry, type AssetEntry, type Registry } from "../verifiedAssets";
import { getPost, likesKey, postKey, roleIn, type Actor, type Deps } from "./board";
import { ALL, appendLog, loadBans } from "./clubState";
import { prizeProblem, viemPrizeChain, type PrizeChain, type PrizeProblem } from "./challengePrizes";
import { addTrophy, awardsKey, challengeKey, challengesKey, enteredKey, entriesKey, entryOfKey, prizeTxKey, readAwards, settleLockKey } from "./challengeState";
import { rewardBans } from "./clubRules";
import { allRows, freshHolder, getMember, type MemberDeps } from "./members";
import { closingKey } from "./rewards";
import type { Store } from "./store";
import { setXShareEntry } from "./xPosts";

/**
 * Club challenges (ADR 0045): the Owner sets a task, members answer with a Board post, and the winners
 * earn activity points in the epoch it ends in. Every function takes the store and the Club, so the
 * rules run against an in-memory store in tests; each refusal is a reason code the routes map to a
 * status and a sentence.
 */

/**
 * The chain reads a raffle makes (ADR 0049): the newest block, to commit one a little past it, and
 * that block's hash once it is final. Real in production (`viemBlocks`), a fake in tests.
 */
export type BlockReader = {
  latest(): Promise<bigint>;
  /** Block `n`'s hash once it is finalized, else null. */
  hashOf(n: bigint): Promise<Hex | null>;
};

let cachedClient: PublicClient | undefined;
const client = () => (cachedClient ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

function viemBlocks(): BlockReader {
  return {
    async latest() {
      return client().getBlockNumber({ cacheTime: 0 });
    },
    async hashOf(n) {
      const final = await client().getBlock({ blockTag: "finalized" });
      if (final.number < n) return null;
      return (await client().getBlock({ blockNumber: n })).hash;
    },
  };
}

/**
 * The Board's deps, the block reader a raffle draws with, the chain reads of an asset prize
 * (ADR 0050) and the verified list it is checked against.
 */
export type ChallengeDeps = Deps & { blocks?: BlockReader; prizeChain?: PrizeChain; registry?: Pick<Registry, "entry"> };

const nowOf = (deps: Pick<Deps, "now">) => deps.now?.() ?? Date.now();
const toEpoch = (ms: number, deps: Pick<Deps, "epochs">) => Math.max(0, epochAt(Math.floor(ms / 1000), deps.epochs?.genesis, deps.epochs?.length));

type ChallengeRefusal =
  | "archived"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "not_member"
  | "banned"
  | "reward_banned"
  | "closed"
  | "holders_only"
  | "too_many_open"
  | "owner_entry"
  | "bad_post"
  | "not_x"
  | "x_not_own"
  | "x_too_old"
  | "already_entered"
  | "full"
  | "not_judging"
  | "no_entry"
  | "busy"
  | "drawing"
  | "prize_overdue"
  | "no_prize"
  | "prize_sent"
  | "tx_used"
  | "tx_not_found"
  | "chain_unavailable"
  | PrizeProblem;

async function load(store: Store, token: string, id: string) {
  return /^[0-9a-f-]{36}$/.test(id) ? store.get<StoredChallenge>(challengeKey(token, id)) : null;
}

export const entriesOf = async (store: Store, token: string, id: string) =>
  (await store.members(entriesKey(token, id))).flatMap((m) => {
    const at = m.indexOf("|");
    return at > 0 ? [{ post: m.slice(0, at), userId: m.slice(at + 1) }] : [];
  });

/** Whether `userId` is the Owner of the Club (or an app admin), who run its challenges. */
const runsChallenges = async (store: Store, token: string, userId: string, deps: Deps) => isOwnerOrAdmin(await roleIn(store, token, userId, deps));

/** The challenge `id` for its Owner (or an app admin) to act on: or why they can't. */
async function ownChallenge(store: Store, entry: AssetEntry, actor: Actor, id: string, deps: Deps) {
  const token = entry.address.toLowerCase();
  if (!(await runsChallenges(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" } as const;
  const c = await load(store, token, id);
  return c ? ({ ok: true, token, c } as const) : ({ ok: false, reason: "not_found" } as const);
}

/** Runs `run` holding the challenge's settle lock, or says it is busy; the lock is let go after. */
async function whileLocked<T>(store: Store, token: string, id: string, run: () => Promise<T>): Promise<T | { ok: false; reason: "busy" }> {
  if ((await store.hit(settleLockKey(token, id), 30)) > 1) return { ok: false, reason: "busy" };
  try {
    return await run();
  } finally {
    await store.del(settleLockKey(token, id));
  }
}

/** The Owner (or an app admin) starts a challenge that runs from now. */
export async function createChallenge(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  input: unknown,
  deps: ChallengeDeps = {},
): Promise<{ ok: true; id: string } | { ok: false; reason: ChallengeRefusal; message?: string }> {
  const token = entry.address.toLowerCase();
  if (!(await runsChallenges(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  // An ERC-20 prize is checked with the decimals its contract reports, read here: never the form's, never assumed.
  const registry = deps.registry ?? defaultRegistry;
  const decimals = await prizeDecimals(input, registry, deps);
  const checked = checkChallenge(input, { registry, decimals: (t) => (t.toLowerCase() === decimals?.token ? decimals.value : null) });
  if (!checked.ok) return { ok: false, reason: "invalid", message: checked.message };
  const now = nowOf(deps);
  const ids = await store.ranked(challengesKey(token), CHALLENGE_RULES.kept);
  const all = await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(token, id)));
  const open = all.filter((c): c is StoredChallenge => !!c && phaseOf(c, now) === "open");
  if (open.length >= CHALLENGE_RULES.maxOpen) return { ok: false, reason: "too_many_open" };
  // Winners still waiting past the due time on a prize from this Club: no new asset prize until they're paid (ADR 0050).
  if (checked.challenge.rewards?.asset && all.some((c) => !!c && prizeOverdue(c, now))) return { ok: false, reason: "prize_overdue" };

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
  const pays = isFlat(challenge.judging)
    ? `${challenge.winners} × ${challenge.prize} points${challenge.minLikes ? ` · ${challenge.minLikes}+ likes` : ""}`
    : `${challenge.prizes.join("/")} points`;
  const asset = challenge.rewards?.asset;
  const extra = `${asset ? ` · plus ${asset.amounts.map((a) => assetText(asset, a)).join("/")}${isFlat(challenge.judging) ? " each" : ""}` : ""}${challenge.rewards?.pinWinner ? " · results pinned" : ""}`;
  await appendLog(
    store,
    token,
    {
      actor: actor.wallet,
      action: "create_challenge",
      target: id,
      detail: `${challenge.title} · ${pays}${extra} · judged by ${challenge.judging}${challenge.holdersOnly ? " · Holders only" : ""}`,
    },
    now,
  );
  return { ok: true, id };
}

/** The decimals of the ERC-20 an Owner named as a prize, read from its contract; null for anything else. */
async function prizeDecimals(
  input: unknown,
  registry: Pick<Registry, "entry">,
  deps: Pick<ChallengeDeps, "prizeChain">,
): Promise<{ token: string; value: number | null } | null> {
  const rewards = typeof input === "object" && input !== null ? (input as { rewards?: unknown }).rewards : undefined;
  const token = typeof rewards === "object" && rewards !== null ? (rewards as { asset?: { token?: unknown } }).asset?.token : undefined;
  if (typeof token !== "string" || !isAddress(token, { strict: false })) return null;
  const entry = registry.entry(token);
  if (entry?.status !== "verified" || entry.kind !== "erc20") return null;
  return { token: token.toLowerCase(), value: await (deps.prizeChain ?? viemPrizeChain()).decimals(token as Address).catch(() => null) };
}

/** The Owner cancels a challenge that hasn't been settled: nobody earns anything from it. */
export async function cancelChallenge(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  id: string,
  deps: Deps = {},
): Promise<{ ok: true } | { ok: false; reason: ChallengeRefusal }> {
  const own = await ownChallenge(store, entry, actor, id, deps);
  if (!own.ok) return own;
  const { token, c } = own;
  if (c.state !== "live") return { ok: false, reason: "closed" };
  // Once a raffle's block is committed its result is fixed (anyone can work it out as soon as the block
  // exists), so calling it off then would be choosing the result (ADR 0049).
  if (c.drawBlock !== undefined) return { ok: false, reason: "drawing" };
  await store.set(challengeKey(token, id), { ...c, state: "cancelled" } satisfies StoredChallenge);
  // Nothing pays for the entries now: they earn like any post again (ADR 0048), in epochs not yet frozen.
  for (const postId of await store.members(enteredKey(token, id))) await cover(store, token, postId, null);
  await appendLog(store, token, { actor: actor.wallet, action: "cancel_challenge", target: id, detail: c.title }, nowOf(deps));
  return { ok: true };
}

type Entrant = Candidate & { text: string; x?: StoredXCard; likers: string[]; votes: number };

/**
 * The entries that can win, with their likes, now. A post that's gone or hidden, or a member who
 * left, was banned or banned from rewards, drops out. `votes` are the likes from members with the
 * Holder badge as it stands, what a Holder vote counts (ADR 0049).
 */
async function candidates(store: Store, token: string, c: StoredChallenge): Promise<Entrant[]> {
  const entries = await entriesOf(store, token, c.id);
  const posts = await store.getMany<StoredPost>(entries.map((e) => postKey(token, e.post)));
  const rows = new Map((await allRows(store, token)).map((r) => [r.userId, r]));
  const banned = new Set([...Object.keys(await loadBans(store, token)), ...Object.keys(await loadBans(store, ALL))]);
  const noRewards = new Set(Object.keys(await rewardBans(store, token)));
  const out: Entrant[] = [];
  for (const [i, e] of entries.entries()) {
    const post = posts[i];
    const row = rows.get(e.userId);
    if (!post || post.userId !== e.userId || post.parent || post.hidden || !row?.displayWallet || banned.has(e.userId) || noRewards.has(e.userId)) continue;
    const likers = (await store.members(likesKey(token, e.post))).filter((u) => u !== e.userId && rows.has(u) && !noRewards.has(u));
    const votes = likers.filter((u) => rows.get(u)?.holder).length;
    out.push({
      post: e.post,
      userId: e.userId,
      wallet: row.displayWallet,
      at: post.at,
      likes: likers.length,
      votes,
      text: post.text,
      ...(post.x ? { x: post.x } : {}),
      likers,
    });
  }
  return out;
}

/**
 * Writes a settlement: the points go to the epoch they count in, then the challenge is marked
 * settled. A winner of no points (a trophy-only prize) is named but adds nothing to the epoch. Safe
 * to repeat.
 */
async function finish(
  store: Store,
  token: string,
  c: StoredChallenge,
  winners: Winner[],
  userOf: ReadonlyMap<string, string>,
  at: number,
  epoch: number,
  by: string,
  extra: { expired?: boolean; draw?: Draw } = {},
) {
  const paying = winners.filter((w) => w.points > 0);
  if (paying.length > 0) {
    const awards = await readAwards(store, token, epoch);
    for (const w of paying) {
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
  const { expired = false, draw } = extra;
  // An asset prize (ADR 0050) is owed by the Owner from here; it never touches the epoch's points.
  const named = winners.map((w): Winner => {
    const prize = assetFor(c, w.place);
    return prize ? { ...w, prize } : w;
  });
  const prizeUsers = Object.fromEntries(named.filter((w) => w.prize).map((w) => [w.post, userOf.get(w.post)!]));
  const settlement: Settlement = {
    at,
    ...(paying.length > 0 ? { epoch } : {}),
    winners: named,
    ...(expired ? { expired: true as const } : {}),
    ...(draw ? { draw } : {}),
  };
  await store.set(challengeKey(token, c.id), {
    ...c,
    state: "settled",
    settled: settlement,
    ...(Object.keys(prizeUsers).length > 0 ? { prizeUsers } : {}),
  } satisfies StoredChallenge);
  // Every winner gets a trophy, whatever the prize (a 0-point win too), keyed by the challenge so a repeat gives one.
  for (const w of named) {
    const userId = userOf.get(w.post);
    if (userId)
      await addTrophy(store, userId, {
        club: token,
        challenge: c.id,
        title: c.title,
        place: trophyPlace(c.judging, w.place),
        at,
        wallet: w.wallet.toLowerCase(),
      });
  }
  await appendLog(
    store,
    token,
    {
      actor: by,
      action: "settle_challenge",
      target: c.id,
      detail: `${c.title} · ${winners.length > 0 ? winners.map((w) => `${w.place}. ${w.wallet} +${w.points}`).join(", ") : expired ? "no pick in time" : "no winner"}${draw ? ` · drawn with block ${draw.block}` : ""}`,
    },
    at,
  );
}

/**
 * The epoch a settlement's points count in: the one the challenge ended in, if it isn't closed yet,
 * else the running one. An Owner's pick counts in the epoch it is made in.
 */
async function awardEpoch(store: Store, token: string, c: StoredChallenge, now: number, deps: Pick<Deps, "epochs">) {
  if (c.judging !== "owner") {
    // `endsAt` is the first instant of the next epoch: it ended in the one before.
    const ended = toEpoch(c.endsAt - 1, deps);
    if (!(await store.get(closingKey(token, ended)))) return ended;
  }
  return toEpoch(now, deps);
}

/** The winners of a challenge that settles itself at its end, from its entries as they are now. */
function winnersOf(c: StoredChallenge, cands: readonly Entrant[]): Winner[] {
  switch (c.judging) {
    case "holders":
      // Only Holders' likes count (ADR 0049): the same ranking, on the votes.
      return winnersByLikes(
        cands.map((x) => ({ ...x, likes: x.votes })),
        c.prizes,
      );
    case "first":
      return winnersByTime(cands, c.winners ?? c.prizes.length, c.prize ?? c.prizes[0] ?? 0);
    case "everyone":
      return winnersByTime(cands, c.winners ?? c.prizes.length, c.prize ?? c.prizes[0] ?? 0, c.minLikes ?? 0);
    default:
      return winnersByLikes(cands, c.prizes);
  }
}

/**
 * A raffle's two steps (ADR 0049), under the settle lock. First it commits: the block
 * `drawMargin` past the newest one, and the entries it draws from. Then, once that block is final,
 * it draws: the seed is keccak256(block hash ‖ challenge id), the pool is shuffled with it
 * (`drawOrder`), and the first `winners` that can still win, win. Returns whether it is settled; a
 * chain read that fails leaves it for the next call.
 */
async function draw(store: Store, token: string, c: StoredChallenge, now: number, deps: Pick<ChallengeDeps, "epochs" | "blocks">): Promise<boolean> {
  const blocks = deps.blocks ?? viemBlocks();
  let committed = c;
  if (c.drawBlock === undefined) {
    const pool = (await candidates(store, token, c)).map((x) => x.post).sort();
    if (pool.length === 0) {
      await finish(store, token, c, [], new Map(), now, await awardEpoch(store, token, c, now, deps), c.by);
      return true;
    }
    let latest: bigint;
    try {
      latest = await blocks.latest();
    } catch {
      return false;
    }
    committed = { ...c, drawBlock: Number(latest) + CHALLENGE_RULES.drawMargin, drawPool: pool };
    await store.set(challengeKey(token, c.id), committed);
  }
  let hash: Hex | null;
  try {
    hash = await blocks.hashOf(BigInt(committed.drawBlock!));
  } catch {
    return false;
  }
  if (!hash) return false;
  const seed = drawSeed(hash, committed.id);
  const cands = await candidates(store, token, committed);
  const pool = committed.drawPool ?? [];
  const prize = committed.prize ?? committed.prizes[0] ?? 0;
  const winners = drawWinners(seed, cands, committed.winners ?? committed.prizes.length, pool).map((x, i): Winner => ({
    post: x.post,
    wallet: x.wallet,
    place: i + 1,
    points: prize,
    likes: x.likes,
  }));
  await finish(
    store,
    token,
    committed,
    winners,
    new Map(cands.map((x) => [x.post, x.userId])),
    now,
    await awardEpoch(store, token, committed, now, deps),
    committed.by,
    {
      draw: { block: committed.drawBlock!, hash, seed, pool },
    },
  );
  return true;
}

/**
 * Settles the Club's challenges that have ended: one judged by likes (or Holders' likes, ADR 0049)
 * picks its winners from the likes it has (they're locked from the end, see `votingClosed`), "first
 * in" and "everyone who completes" from the entries that still stand, a raffle commits its block and
 * then draws (two calls at least); an Owner-judged one that wasn't picked in time expires with none.
 * Called when challenges are read and by the epoch close, so a finished challenge's points are in
 * before its epoch is frozen. Returns how many it settled.
 */
export async function settleDue(store: Store, entry: AssetEntry, deps: Pick<ChallengeDeps, "now" | "epochs" | "blocks"> = {}): Promise<number> {
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
        await finish(store, token, fresh, [], new Map(), now, toEpoch(now, deps), fresh.by, { expired: true });
      } else if (fresh.judging === "raffle") {
        if (!(await draw(store, token, fresh, now, deps))) continue;
      } else {
        const cands = await candidates(store, token, fresh);
        await finish(
          store,
          token,
          fresh,
          winnersOf(fresh, cands),
          new Map(cands.map((x) => [x.post, x.userId])),
          now,
          await awardEpoch(store, token, fresh, now, deps),
          fresh.by,
        );
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
  // A post from an epoch already frozen has earned there; its prize can't cover it too (ADR 0048).
  if (await store.get(closingKey(token, toEpoch(post.at, deps)))) return { ok: false, reason: "bad_post" };
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
  await cover(store, token, postId, id);
  return { ok: true };
}

/**
 * Marks Board post `postId` as covered by challenge `id` (ADR 0048), or clears the mark with null:
 * a covered post still counts toward Momentum, but its prize is what it earns, so it makes no active
 * day, its X share no X-share points and its likes and replies back nobody. The mark stays after a
 * withdrawal (a post can't collect backing while entered, then be taken back to keep it), and the
 * challenge keeps every post it covered so a cancellation can clear them all.
 */
async function cover(store: Store, token: string, postId: string, id: string | null) {
  const post = await getPost(store, token, postId);
  if (!post) return;
  if (id) await store.addMember(enteredKey(token, id), postId);
  const next: StoredPost = { ...post };
  if (id) next.entry = id;
  else delete next.entry;
  if ((post.entry ?? null) !== id) await store.set(postKey(token, postId), next);
  if (post.x?.counted) await setXShareEntry(store, token, post.x.id, postId, id);
}

/** A member takes their entry back while the challenge is open. */
export async function withdrawEntry(
  store: Store,
  entry: AssetEntry,
  userId: string,
  id: string,
  deps: Deps = {},
): Promise<{ ok: true } | { ok: false; reason: ChallengeRefusal }> {
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
  const own = await ownChallenge(store, entry, actor, id, deps);
  if (!own.ok) return own;
  const { token, c } = own;
  const now = nowOf(deps);
  if (c.judging !== "owner" || phaseOf(c, now) !== "judging" || now >= c.endsAt + CHALLENGE_RULES.pickWindowMs) return { ok: false, reason: "not_judging" };
  if (!Array.isArray(picked) || picked.some((p) => typeof p !== "string"))
    return { ok: false, reason: "invalid", message: "Send the post ids of the winners, best first." };
  return whileLocked(store, token, id, async () => {
    const fresh = await load(store, token, id);
    if (!fresh || fresh.state !== "live") return { ok: false, reason: "closed" };
    const cands = await candidates(store, token, fresh);
    const result = winnersByPick(picked as string[], cands, fresh.prizes);
    if (!result.ok) return { ok: false, reason: "invalid", message: result.message };
    await finish(store, token, fresh, result.winners, new Map(cands.map((x) => [x.post, x.userId])), now, toEpoch(now, deps), actor.wallet);
    return { ok: true, winners: result.winners };
  });
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
    // Ranked by what decides: likes, Holders' likes, or (first in, everyone, a raffle) the time posted.
    const byTime = isFlat(c.judging);
    const holders = c.judging === "holders";
    entries = cands
      .map((x): PublicEntry => ({
        post: x.post,
        wallet: x.wallet,
        at: x.at,
        likes: x.likes,
        liked: !!viewer.userId && x.likers.includes(viewer.userId),
        mine: x.userId === viewer.userId,
        text: x.text,
        ...(x.x ? { x: x.x } : {}),
        ...(winnerPlace.has(x.post) ? { place: winnerPlace.get(x.post)! } : {}),
        ...(holders ? { votes: x.votes } : {}),
      }))
      .sort(
        (a, b) =>
          (winnerPlace.get(a.post) ?? 99) - (winnerPlace.get(b.post) ?? 99) ||
          (byTime ? 0 : holders ? (b.votes ?? 0) - (a.votes ?? 0) : b.likes - a.likes) ||
          a.at - b.at ||
          (a.post < b.post ? -1 : a.post > b.post ? 1 : 0),
      );
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
    ...(isFlat(c.judging) ? { winners: c.winners ?? c.prizes.length, prize: c.prize ?? c.prizes[0] ?? 0 } : {}),
    ...(c.judging === "everyone" ? { minLikes: c.minLikes ?? 0 } : {}),
    ...(c.drawBlock !== undefined && c.state === "live" ? { drawBlock: c.drawBlock } : {}),
    ...(c.rewards ? { rewards: c.rewards } : {}),
    ...(c.settled && c.rewards?.asset && c.settled.winners.some((w) => w.prize) ? { prizeDueBy: c.settled.at + CHALLENGE_RULES.prizeDueMs } : {}),
    ...(c.settled && c.rewards?.pinWinner && c.settled.winners.length > 0 ? { pinUntil: c.settled.at + CHALLENGE_RULES.pinResultsMs } : {}),
  };
}

/**
 * The Owner (or an admin) reports a winner's asset prize sent (ADR 0050): `tx` must be a successful
 * transaction, mined after the challenge settled, with Transfer logs of the prize's own contract to
 * one of the winner's linked wallets adding up to what they're owed. A transaction pays one prize.
 * The app never holds or sends a prize; it only checks the one the Owner sent.
 */
export async function sendPrize(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  id: string,
  body: { post?: unknown; tx?: unknown },
  deps: ChallengeDeps = {},
): Promise<{ ok: true; winner: Winner } | { ok: false; reason: ChallengeRefusal; message?: string }> {
  const own = await ownChallenge(store, entry, actor, id, deps);
  if (!own.ok) return own;
  const { token, c } = own;
  const { post, tx } = body;
  if (typeof post !== "string" || typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx))
    return { ok: false, reason: "invalid", message: "Send the winning entry and the transaction hash (0x…)." };
  const asset = c.rewards?.asset;
  const won = c.settled?.winners.find((w) => w.post === post);
  if (c.state !== "settled" || !asset || !won?.prize) return { ok: false, reason: "no_prize" };
  if (won.sent) return { ok: false, reason: "prize_sent" };
  if (await store.get(prizeTxKey(tx))) return { ok: false, reason: "tx_used" };
  return whileLocked(store, token, id, async () => {
    const fresh = await load(store, token, id);
    const w = fresh?.settled?.winners.find((x) => x.post === post);
    if (!fresh?.settled || !w?.prize) return { ok: false, reason: "no_prize" };
    if (w.sent) return { ok: false, reason: "prize_sent" };
    if (await store.get(prizeTxKey(tx))) return { ok: false, reason: "tx_used" };
    let receipt;
    try {
      receipt = await (deps.prizeChain ?? viemPrizeChain()).receipt(tx as Hex);
    } catch {
      return { ok: false, reason: "chain_unavailable" };
    }
    if (!receipt) return { ok: false, reason: "tx_not_found" };
    // Any wallet the winner has linked counts, and the one their win was published under.
    const userId = fresh.prizeUsers?.[post];
    const row = userId ? await getMember(store, token, userId) : null;
    const to = new Set([w.wallet.toLowerCase(), ...(row?.wallets ?? []).map((x) => x.toLowerCase())]);
    const problem = prizeProblem(receipt, asset, w.prize, to, fresh.settled.at);
    if (problem) return { ok: false, reason: problem };
    const now = nowOf(deps);
    const sent = { tx: tx.toLowerCase(), at: now };
    await store.set(prizeTxKey(tx), { club: token, challenge: id, post });
    const winners = fresh.settled.winners.map((x) => (x.post === post ? { ...x, sent } : x));
    await store.set(challengeKey(token, id), { ...fresh, settled: { ...fresh.settled, winners } } satisfies StoredChallenge);
    await appendLog(
      store,
      token,
      { actor: actor.wallet, action: "prize_sent", target: id, detail: `${fresh.title} · ${assetText(asset, w.prize)} to ${w.wallet} · ${sent.tx}` },
      now,
    );
    return { ok: true, winner: { ...w, sent } };
  });
}

/** One challenge with its entries, settling it first if it has ended; null when the Club has no such challenge. */
export async function getChallenge(
  store: Store,
  entry: AssetEntry,
  id: string,
  viewer: { userId?: string },
  deps: ChallengeDeps = {},
): Promise<PublicChallenge | null> {
  const token = entry.address.toLowerCase();
  await settleDue(store, entry, deps);
  const c = await load(store, token, id);
  return c ? viewOf(store, token, c, viewer, nowOf(deps)) : null;
}

/**
 * The Club's challenges as `userId` sees them: open ones first (soonest end first), then those
 * being judged or settled, newest first. Settles what has ended first.
 */
export async function listChallenges(store: Store, entry: AssetEntry, viewer: { userId?: string }, deps: ChallengeDeps = {}): Promise<PublicChallenge[]> {
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

/** The most challenges the timeline's Challenges filter lists: every running one, then the newest that ended. */
export const TIMELINE_CHALLENGES_MAX = 60;

/**
 * The challenges in `clubs`, each with its Club, in standing order: those still running or waiting
 * on their result, pinned on top of the timeline, or with `past` also the settled ones (not the
 * cancelled), for the timeline's Challenges filter, up to `TIMELINE_CHALLENGES_MAX`. Only a Club with
 * one that has ended is settled first, so reading every Club stays cheap.
 */
export async function timelineChallenges(
  store: Store,
  clubs: readonly AssetEntry[],
  viewer: { userId?: string },
  deps: ChallengeDeps = {},
  { past = false }: { past?: boolean } = {},
): Promise<{ club: string; challenge: PublicChallenge }[]> {
  const now = nowOf(deps);
  const shown = (phase: Phase) => isLive(phase) || (past && phase === "settled");
  const lists = await Promise.all(
    clubs.map(async (entry) => {
      const token = entry.address.toLowerCase();
      const read = async () => {
        const ids = await store.ranked(challengesKey(token), 30);
        return (await store.getMany<StoredChallenge>(ids.map((id) => challengeKey(token, id)))).filter(
          (c): c is StoredChallenge => !!c && shown(phaseOf(c, now)),
        );
      };
      let list = await read();
      if (list.some((c) => c.state === "live" && now >= c.endsAt) && (await settleDue(store, entry, deps)) > 0) list = await read();
      return Promise.all(list.map(async (c) => ({ club: token, challenge: await viewOf(store, token, c, viewer, now) })));
    }),
  );
  const sorted = lists.flat().sort((a, b) => byStanding(a.challenge, b.challenge));
  return past ? sorted.slice(0, TIMELINE_CHALLENGES_MAX) : sorted;
}
