import { createPublicClient, getAddress, http, verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { chain } from "../chain";
import { CHAIN_ID, RPC_URL } from "../config";
import { SIGNED_SKEW_SEC, followTypedData, type FollowMessage } from "../social";
import { withinLimit, type Store } from "./store";

/**
 * Follows (ADR 0023): a wallet following another, as a signed record anyone can verify. The graph
 * is keyed by wallet, not by account, so it can be exported and read without this app. The newest
 * record between two wallets wins, so an unfollow signed later undoes a follow signed earlier.
 */
const base = `declub:follow:${CHAIN_ID}`;
const followsKey = (wallet: string) => `${base}:out:${wallet.toLowerCase()}`;
const followersKey = (wallet: string) => `${base}:in:${wallet.toLowerCase()}`;
const followRecordKey = (follower: string, target: string) => `${base}:rec:${follower.toLowerCase()}:${target.toLowerCase()}`;

/** A wallet follows at most this many others. */
const MAX_FOLLOWS = 1_000;
/** Follow or unfollow at most this many times an hour per user. */
const FOLLOWS_PER_HOUR = 120;

type FollowRecord = { message: FollowMessage; signature: Hex };

export type FollowDeps = {
  /** Unix seconds. */
  now?: () => number;
  verifyFollow?: (message: FollowMessage, signature: Hex) => Promise<boolean>;
};

type FollowRefusal = "unsigned" | "not_yours" | "self" | "stale" | "bad_signature" | "outdated" | "too_many" | "rate_limited";

let verifier: PublicClient | undefined;
async function viemVerifyFollow(message: FollowMessage, signature: Hex): Promise<boolean> {
  // A plain wallet's signature is checked here; only a smart wallet costs a call (ERC-1271).
  if (await verifyTypedData({ address: message.follower, signature, ...followTypedData(message) }).catch(() => false)) return true;
  verifier ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;
  try {
    if (!(await verifier.getCode({ address: message.follower }))) return false;
    return await verifier.verifyTypedData({ address: message.follower, signature, ...followTypedData(message) });
  } catch {
    return false;
  }
}

/**
 * Records a signed follow or unfollow. The follower must be one of the caller's linked wallets
 * (`wallets`, read from Privy, never from the request), and the record newer than the last one.
 */
export async function recordFollow(
  store: Store,
  userId: string,
  wallets: readonly string[],
  body: { message: FollowMessage | null; signature: unknown },
  deps: FollowDeps = {},
): Promise<{ ok: true; following: boolean } | { ok: false; reason: FollowRefusal }> {
  const { message, signature } = body;
  if (!message || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return { ok: false, reason: "unsigned" };
  if (!wallets.some((w) => w.toLowerCase() === message.follower.toLowerCase())) return { ok: false, reason: "not_yours" };
  if (message.follower.toLowerCase() === message.target.toLowerCase()) return { ok: false, reason: "self" };
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  if (Math.abs(message.at - now) > SIGNED_SKEW_SEC) return { ok: false, reason: "stale" };
  if (!(await (deps.verifyFollow ?? viemVerifyFollow)(message, signature as Hex))) return { ok: false, reason: "bad_signature" };

  const key = followRecordKey(message.follower, message.target);
  const previous = await store.get<FollowRecord>(key);
  if (previous && previous.message.at >= message.at) return { ok: false, reason: "outdated" };
  if (message.following && (await store.countMembers(followsKey(message.follower))) >= MAX_FOLLOWS) return { ok: false, reason: "too_many" };
  if (!(await withinLimit(store, "follow", userId, FOLLOWS_PER_HOUR, 3600))) return { ok: false, reason: "rate_limited" };

  await store.set(key, { message, signature: signature as Hex } satisfies FollowRecord);
  const follower = message.follower.toLowerCase();
  const target = message.target.toLowerCase();
  if (message.following) {
    await store.addMember(followsKey(follower), target);
    await store.addMember(followersKey(target), follower);
  } else {
    await store.removeMember(followsKey(follower), target);
    await store.removeMember(followersKey(target), follower);
  }
  return { ok: true, following: message.following };
}

/** Who `wallet` follows, lowercase. */
export async function followingOf(store: Store, wallet: string): Promise<Set<string>> {
  return new Set(await store.members(followsKey(wallet)));
}

/** `wallet`'s follows as signed records, for the export, and how many follow it. */
export async function exportFollows(store: Store, wallet: string): Promise<{ wallet: Address; follows: FollowRecord[]; followers: number }> {
  const targets = await store.members(followsKey(wallet));
  const records = await store.getMany<FollowRecord>(targets.map((t) => followRecordKey(wallet, t)));
  return {
    wallet: getAddress(wallet),
    follows: records.filter((r): r is FollowRecord => r !== null && r.message.following),
    followers: await store.countMembers(followersKey(wallet)),
  };
}
