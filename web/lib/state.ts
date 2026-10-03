import { isAddress } from "viem";
import { CHAIN_ID, ON_DEAL_V2_ADDRESS } from "./config";

/**
 * Per-user saved state (ADR 0012): what the app used to keep only in one browser's localStorage,
 * for people signed in with Privy. Everything here is safe to lose and safe to merge: read markers
 * and recently used collections only ever grow, so two devices simply add up.
 */

/** Notification keys, as built in lib/notifications.ts: "filled:12", "intent-settled:0x…". */
const SEEN_KEY = /^[a-z-]{3,24}:[A-Za-z0-9]{1,70}$/;

export const MAX_SEEN_PER_REQUEST = 500;
export const MAX_SEEN_ACCOUNT_KEYS = 1_000;
export const MAX_RECENTS = 8;

export const isSeenKey = (value: unknown): value is string => typeof value === "string" && SEEN_KEY.test(value);

/** At most `max` values that pass `ok`, for a client-sent list. Anything else in it is dropped. */
export function onlyValid<T>(list: unknown, ok: (value: unknown) => value is T, max: number): T[] {
  return Array.isArray(list) ? list.filter(ok).slice(0, max) : [];
}

export const isAddressString = (value: unknown): value is string => typeof value === "string" && isAddress(value, { strict: false });

// Notification keys name deal ids, so read markers are kept per deal contract.
const scope = (userId: string, account: string) =>
  `${userId}:${CHAIN_ID}:${(ON_DEAL_V2_ADDRESS ?? "none").toLowerCase()}:${account.toLowerCase()}`;
export const seenKey = (userId: string, account: string) => `ondeal:seen:${scope(userId, account)}`;
export const seenInitKey = (userId: string, account: string) => `ondeal:seen-init:${scope(userId, account)}`;
export const recentsKey = (userId: string) => `ondeal:recents:${userId}`;
