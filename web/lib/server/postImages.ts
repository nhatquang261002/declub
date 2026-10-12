import { createHash } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import type { Hex } from "viem";
import { CHAIN_ID } from "../config";
import { POST_IMAGE_MAX_BYTES, POST_IMAGE_TYPES, type PostImageType } from "../clubPosts";
import { looksLike } from "./avatars";

/**
 * Pictures on Board posts (ADR 0056). The bytes live in object storage (Vercel Blob, a private
 * store), not in Redis: one post may weigh a megabyte, and the Club keeps hundreds. Nothing public
 * points at the store; `/api/clubs/[token]/posts/[id]/image` reads from it after checking that the
 * post isn't hidden from the reader, so hiding a post hides its picture too.
 */
export type ImageStore = {
  put(key: string, bytes: Uint8Array, type: PostImageType): Promise<void>;
  /** `null` when nothing is kept under `key`. */
  get(key: string): Promise<{ bytes: Uint8Array; type: string } | null>;
  /** Removes the pictures under `keys`; a key with nothing under it is fine. */
  del(...keys: string[]): Promise<void>;
};

/** Where a post's picture is kept: one object per post, so deleting a post can never take another's. */
export const postImageKey = (club: string, postId: string) => `post-images/${CHAIN_ID}/${club.toLowerCase()}/${postId}`;

const vercelBlob = (token: string): ImageStore => ({
  async put(key, bytes, type) {
    await put(key, Buffer.from(bytes), { access: "private", contentType: type, addRandomSuffix: false, allowOverwrite: true, token });
  },
  async get(key) {
    const found = await get(key, { access: "private", token });
    if (!found || found.statusCode !== 200) return null;
    return { bytes: new Uint8Array(await new Response(found.stream).arrayBuffer()), type: found.blob.contentType };
  },
  async del(...keys) {
    if (keys.length > 0) await del(keys, { token });
  },
});

/** An in-memory store: what development uses without a token, and what tests use. */
export function memoryImageStore(): ImageStore & { keys(): string[] } {
  const kept = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    async put(key, bytes, type) {
      kept.set(key, { bytes, type });
    },
    async get(key) {
      return kept.get(key) ?? null;
    },
    async del(...keys) {
      for (const key of keys) kept.delete(key);
    },
    keys: () => [...kept.keys()],
  };
}

/**
 * The picture store, or `null` where there is none (production without `BLOB_READ_WRITE_TOKEN`):
 * posts with a picture are then refused, and text posts carry on. In development an in-memory copy
 * stands in, kept on globalThis so hot reloads don't empty it.
 */
export function getImageStore(): ImageStore | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return vercelBlob(token);
  if (process.env.NODE_ENV === "production") return null;
  const g = globalThis as { __declubImages?: ImageStore };
  return (g.__declubImages ??= memoryImageStore());
}

/** The picture store a function should use: the one it was given (`null` for none), else the configured one. */
export const imagesOf = (deps: { images?: ImageStore | null }) => (deps.images === undefined ? getImageStore() : deps.images);

/** The SHA-256 of `bytes` as a post signs it. */
export const imageHash = (bytes: Uint8Array): Hex => `0x${createHash("sha256").update(bytes).digest("hex")}`;

export type PostPicture = { type: PostImageType; bytes: Uint8Array; hash: Hex };

/**
 * A `data:image/…;base64,…` URL as a picture to keep, or `null` when it isn't a PNG, JPEG or WebP
 * (never SVG, which can carry script), is too big, or its bytes aren't what it claims. The browser
 * has already shrunk it; this is the check for a client that didn't. `maxBytes` is the most it may
 * weigh, decoded (a post's picture, or a smaller Club emoji).
 */
export function parsePostImage(url: unknown, maxBytes = POST_IMAGE_MAX_BYTES): PostPicture | null {
  if (typeof url !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match) return null;
  const type = match[1] as PostImageType;
  if (!POST_IMAGE_TYPES.includes(type)) return null;
  // Base64 is 4/3 of the bytes; a body far past the cap isn't decoded at all.
  if (match[2].length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
  if (bytes.length === 0 || bytes.length > maxBytes || !looksLike(type, bytes)) return null;
  return { type, bytes, hash: imageHash(bytes) };
}
