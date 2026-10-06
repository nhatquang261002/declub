import { getAddress, hashStruct, isAddress, isHex, type Address, type Hex } from "viem";
import { CHAIN_ID } from "./config";
import { cleanText, linkFor, type PostLink } from "./clubPosts";
import { xStatusUrl } from "./xPosts";

/**
 * Portable social records (ADR 0023): Board posts and follows are EIP-712 messages signed by the
 * author's wallet, so they can be exported and checked by anyone, outside this app. The domain
 * names no contract: no contract accepts these, and a post signature can't be mistaken for
 * anything a contract would act on.
 */
export const socialDomain = (chainId = CHAIN_ID) => ({ name: "DeClub Social", version: "1", chainId }) as const;

export const SOCIAL_TYPES = {
  Post: [
    { name: "club", type: "address" },
    { name: "kind", type: "string" },
    { name: "text", type: "string" },
    { name: "link", type: "string" },
    { name: "at", type: "uint64" },
  ],
  /** A reply to a top-level post (ADR 0032): `parent` is the post's id. A separate type, so posts' ids stay as they were. */
  Reply: [
    { name: "club", type: "address" },
    { name: "parent", type: "string" },
    { name: "text", type: "string" },
    { name: "at", type: "uint64" },
  ],
  Follow: [
    { name: "follower", type: "address" },
    { name: "target", type: "address" },
    { name: "following", type: "bool" },
    { name: "at", type: "uint64" },
  ],
} as const;

/** The `at` to sign now: unix seconds. */
export const signingTime = () => Math.floor(Date.now() / 1000);

/** How far a signed record's `at` may be from the server's clock when it's submitted. */
export const SIGNED_SKEW_SEC = 300;

/** A post as signed. `at` is unix seconds; `link` is "", a deal id, an intent hash or an X post link. */
export type PostMessage = { club: Address; kind: "note" | "looking"; text: string; link: string; at: number };
export type FollowMessage = { follower: Address; target: Address; following: boolean; at: number };
/** A reply as signed: `parent` is the replied-to post's id. */
export type ReplyMessage = { club: Address; parent: string; text: string; at: number };

/** The link as a post signs it: the canonical form `parseLink` gives, or "" for none. */
export const linkString = (link: PostLink | undefined) =>
  !link ? "" : link.kind === "deal" ? link.id : link.kind === "intent" ? link.hash : xStatusUrl(link.id);

const wirePost = (m: PostMessage) => ({ ...m, at: BigInt(m.at) });
const wireFollow = (m: FollowMessage) => ({ ...m, at: BigInt(m.at) });
const wireReply = (m: ReplyMessage) => ({ ...m, at: BigInt(m.at) });

export const postTypedData = (m: PostMessage, chainId = CHAIN_ID) =>
  ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "Post", message: wirePost(m) }) as const;

export const followTypedData = (m: FollowMessage, chainId = CHAIN_ID) =>
  ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "Follow", message: wireFollow(m) }) as const;

/** A post's id: its struct hash, without the 0x. The same signed post is the same post. */
export const postId = (m: PostMessage) =>
  hashStruct({ data: wirePost(m), primaryType: "Post", types: SOCIAL_TYPES }).slice(2).toLowerCase();

export const replyTypedData = (m: ReplyMessage, chainId = CHAIN_ID) =>
  ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "Reply", message: wireReply(m) }) as const;

/** A reply's id: its struct hash, without the 0x. */
export const replyId = (m: ReplyMessage) =>
  hashStruct({ data: wireReply(m), primaryType: "Reply", types: SOCIAL_TYPES }).slice(2).toLowerCase();

/** The reply a client should sign: the text cleaned exactly as the server will check it. */
export function draftReply(club: Address, parent: string, text: string, at: number): { ok: true; message: ReplyMessage } | { ok: false; reason: "empty" | "too_long" } {
  const clean = cleanText(text);
  if (!clean.ok) return clean;
  return { ok: true, message: { club: getAddress(club), parent: parent.toLowerCase(), text: clean.text, at } };
}

/** A reply message from a request body, or null when it isn't one. */
export function parseReplyMessage(input: unknown): ReplyMessage | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (typeof m.club !== "string" || !isAddress(m.club, { strict: false })) return null;
  if (typeof m.parent !== "string" || !/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(m.parent)) return null;
  if (typeof m.text !== "string") return null;
  if (typeof m.at !== "number" || !Number.isSafeInteger(m.at) || m.at < 0) return null;
  return { club: getAddress(m.club), parent: m.parent, text: m.text, at: m.at };
}

/**
 * The post a client should sign for this input, or why it can't be one: the text cleaned and the
 * link in canonical form, exactly as the server will check them.
 */
export function draftPost(club: Address, kind: "note" | "looking", text: string, link: string, at: number):
  | { ok: true; message: PostMessage }
  | { ok: false; reason: "empty" | "too_long" | "bad_link" } {
  const clean = cleanText(text);
  if (!clean.ok) return clean;
  let canonical = "";
  if (link.trim() !== "") {
    const parsed = linkFor(kind, link);
    if (!parsed) return { ok: false, reason: "bad_link" };
    canonical = linkString(parsed);
  }
  return { ok: true, message: { club: getAddress(club), kind, text: clean.text, link: canonical, at } };
}

/** A post message from a request body, or null when it isn't one. Nothing is trusted yet. */
export function parsePostMessage(input: unknown): PostMessage | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (typeof m.club !== "string" || !isAddress(m.club, { strict: false })) return null;
  if (m.kind !== "note" && m.kind !== "looking") return null;
  if (typeof m.text !== "string" || typeof m.link !== "string") return null;
  if (typeof m.at !== "number" || !Number.isSafeInteger(m.at) || m.at < 0) return null;
  return { club: getAddress(m.club), kind: m.kind, text: m.text, link: m.link, at: m.at };
}

export function parseFollowMessage(input: unknown): FollowMessage | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (typeof m.follower !== "string" || !isAddress(m.follower, { strict: false })) return null;
  if (typeof m.target !== "string" || !isAddress(m.target, { strict: false })) return null;
  if (typeof m.following !== "boolean") return null;
  if (typeof m.at !== "number" || !Number.isSafeInteger(m.at) || m.at < 0) return null;
  return { follower: getAddress(m.follower), target: getAddress(m.target), following: m.following, at: m.at };
}

/** A 65-byte signature, or a longer one a smart wallet (ERC-1271) may produce. */
export const isSignature = (value: unknown): value is Hex => typeof value === "string" && isHex(value) && value.length >= 132 && value.length <= 4_002;

/** A signed post as the export serves it: the message and signature anyone can verify. */
export type SignedPost = {
  id: string;
  signer: Address;
  message: PostMessage;
  signature: Hex;
};

/** A signed reply as the export serves it. */
export type SignedReply = {
  id: string;
  signer: Address;
  message: ReplyMessage;
  signature: Hex;
};
