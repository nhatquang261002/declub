import { getAddress, hashStruct, isAddress, type Address, type Hex } from "viem";
import { CHAIN_ID } from "./config";
import { cleanText, linkFor, type PostImageType, type PostLink } from "./clubPosts";
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
  /**
   * A post with a picture (ADR 0056). `image` is the SHA-256 of the picture's bytes, so the signature
   * covers the picture and anyone can check a copy against it. A separate type, so posts without a
   * picture keep their ids and signatures.
   */
  ImagePost: [
    { name: "club", type: "address" },
    { name: "kind", type: "string" },
    { name: "text", type: "string" },
    { name: "link", type: "string" },
    { name: "image", type: "bytes32" },
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
  /** A member's consent to be on a Club's list (ADR 0053): the proof a backup is restored from. */
  Join: [
    { name: "club", type: "address" },
    { name: "wallet", type: "address" },
    { name: "at", type: "uint64" },
  ],
} as const;

/** The `at` to sign now: unix seconds. */
export const signingTime = () => Math.floor(Date.now() / 1000);

/** How far a signed record's `at` may be from the server's clock when it's submitted. */
export const SIGNED_SKEW_SEC = 300;

/**
 * A post as signed. `at` is unix seconds; `link` is "", a deal id, an intent hash or an X post link.
 * `image` is the SHA-256 of the post's picture; a post with one is an `ImagePost`, signed as such.
 */
export type PostMessage = { club: Address; kind: "note" | "looking"; text: string; link: string; at: number; image?: Hex };
export type FollowMessage = { follower: Address; target: Address; following: boolean; at: number };
/** A membership as signed: `wallet` is the one the Members list shows for the member. */
export type JoinMessage = { club: Address; wallet: Address; at: number };
/** A reply as signed: `parent` is the replied-to post's id. */
export type ReplyMessage = { club: Address; parent: string; text: string; at: number };

/** The link as a post signs it: the canonical form `parseLink` gives, or "" for none. */
export const linkString = (link: PostLink | undefined) =>
  !link ? "" : link.kind === "deal" ? link.id : link.kind === "intent" ? link.hash : xStatusUrl(link.id);

const wirePost = (m: PostMessage) => ({ club: m.club, kind: m.kind, text: m.text, link: m.link, at: BigInt(m.at) });
const wireImagePost = (m: PostMessage & { image: Hex }) => ({ ...wirePost(m), image: m.image });
const wireFollow = (m: FollowMessage) => ({ ...m, at: BigInt(m.at) });
const wireJoin = (m: JoinMessage) => ({ ...m, at: BigInt(m.at) });
const wireReply = (m: ReplyMessage) => ({ ...m, at: BigInt(m.at) });

export const joinTypedData = (m: JoinMessage, chainId = CHAIN_ID) =>
  ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "Join", message: wireJoin(m) }) as const;

export const postTypedData = (m: PostMessage, chainId = CHAIN_ID) =>
  m.image
    ? ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "ImagePost", message: wireImagePost({ ...m, image: m.image }) } as const)
    : ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "Post", message: wirePost(m) } as const);

export const followTypedData = (m: FollowMessage, chainId = CHAIN_ID) =>
  ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "Follow", message: wireFollow(m) }) as const;

/** A post's id: its struct hash, without the 0x. The same signed post is the same post. */
export const postId = (m: PostMessage) =>
  (m.image
    ? hashStruct({ data: wireImagePost({ ...m, image: m.image }), primaryType: "ImagePost", types: SOCIAL_TYPES })
    : hashStruct({ data: wirePost(m), primaryType: "Post", types: SOCIAL_TYPES })
  )
    .slice(2)
    .toLowerCase();

export const replyTypedData = (m: ReplyMessage, chainId = CHAIN_ID) =>
  ({ domain: socialDomain(chainId), types: SOCIAL_TYPES, primaryType: "Reply", message: wireReply(m) }) as const;

/** A reply's id: its struct hash, without the 0x. */
export const replyId = (m: ReplyMessage) =>
  hashStruct({ data: wireReply(m), primaryType: "Reply", types: SOCIAL_TYPES })
    .slice(2)
    .toLowerCase();

/** The reply a client should sign: the text cleaned exactly as the server will check it. */
export function draftReply(
  club: Address,
  parent: string,
  text: string,
  at: number,
): { ok: true; message: ReplyMessage } | { ok: false; reason: "empty" | "too_long" } {
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

/** The SHA-256 of a picture's bytes as a post signs it: 0x and 64 lowercase hex digits. */
export const IMAGE_HASH = /^0x[0-9a-f]{64}$/;

/**
 * The post a client should sign for this input, or why it can't be one: the text cleaned and the
 * link in canonical form, exactly as the server will check them. `image` is the picture's hash, if it has one.
 */
export function draftPost(
  club: Address,
  kind: "note" | "looking",
  text: string,
  link: string,
  at: number,
  image?: Hex,
): { ok: true; message: PostMessage } | { ok: false; reason: "empty" | "too_long" | "bad_link" } {
  const clean = cleanText(text);
  if (!clean.ok) return clean;
  let canonical = "";
  if (link.trim() !== "") {
    const parsed = linkFor(kind, link);
    if (!parsed) return { ok: false, reason: "bad_link" };
    canonical = linkString(parsed);
  }
  return { ok: true, message: { club: getAddress(club), kind, text: clean.text, link: canonical, at, ...(image ? { image } : {}) } };
}

/** A post message from a request body, or null when it isn't one. Nothing is trusted yet. */
export function parsePostMessage(input: unknown): PostMessage | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (typeof m.club !== "string" || !isAddress(m.club, { strict: false })) return null;
  if (m.kind !== "note" && m.kind !== "looking") return null;
  if (typeof m.text !== "string" || typeof m.link !== "string") return null;
  if (typeof m.at !== "number" || !Number.isSafeInteger(m.at) || m.at < 0) return null;
  if (m.image !== undefined && (typeof m.image !== "string" || !IMAGE_HASH.test(m.image))) return null;
  return { club: getAddress(m.club), kind: m.kind, text: m.text, link: m.link, at: m.at, ...(m.image ? { image: m.image as Hex } : {}) };
}

/** A join message from a request body or a backup file, or null when it isn't one. */
export function parseJoinMessage(input: unknown): JoinMessage | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (typeof m.club !== "string" || !isAddress(m.club, { strict: false })) return null;
  if (typeof m.wallet !== "string" || !isAddress(m.wallet, { strict: false })) return null;
  if (typeof m.at !== "number" || !Number.isSafeInteger(m.at) || m.at < 0) return null;
  return { club: getAddress(m.club), wallet: getAddress(m.wallet), at: m.at };
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

/** A signed post as the export serves it: the message and signature anyone can verify. */
export type SignedPost = {
  id: string;
  signer: Address;
  message: PostMessage;
  signature: Hex;
  /** Where the picture can be fetched, for a post that has one; its SHA-256 is `message.image`. */
  image?: { url: string; type: PostImageType };
};

/** A signed reply as the export serves it. */
export type SignedReply = {
  id: string;
  signer: Address;
  message: ReplyMessage;
  signature: Hex;
};
