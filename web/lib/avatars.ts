import type { Address } from "viem";

/**
 * Account avatars (ADR 0028): one picture the signed-in user picks for every wallet linked to their
 * sign-in, either an NFT one of those wallets holds or an image they upload. This file is shared by
 * the browser and the server.
 */

/** What other people's browsers get: the picture to draw, and the NFT it is when it is one. */
export type AvatarView = { image: string; nft?: { collection: Address; tokenId: string } };

/** What the server keeps for each wallet. The same row is written for each of the user's wallets. */
export type StoredAvatar = {
  userId: string;
  /** An https URL, or absent when the picture itself is kept here (`avatarImageKey`). */
  image?: string;
  /** When it was set; also busts caches of a kept picture. */
  version: number;
  /** An NFT avatar shows only while `holder`, one of the user's wallets, still owns the token. */
  nft?: { collection: Address; tokenId: string; holder: string };
};

/** A picture kept in the store: an upload, or an NFT whose art is an inline `data:` image. */
export type StoredImage = { type: AvatarImageType; data: string; version: number };

export const AVATAR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"] as const;
export type AvatarImageType = (typeof AVATAR_IMAGE_TYPES)[number];

/** Uploads are cropped and shrunk to this square in the browser before they are sent. */
export const UPLOAD_SIZE = 256;
/** The most a kept picture may weigh, decoded. A 256px WebP is usually 10–30 KB. */
export const MAX_IMAGE_BYTES = 96_000;

export const avatarKey = (address: string) => `declub:avatar:${address.toLowerCase()}`;
export const avatarWalletsKey = (userId: string) => `declub:avatar-user:${userId}`;
export const avatarImageKey = (userId: string) => `declub:avatar-img:${userId}`;

/** Where a kept picture is served from. */
export const keptImageUrl = (address: string, version: number) => `/api/avatars/${address.toLowerCase()}?v=${version}`;

export function avatarView(address: string, row: StoredAvatar): AvatarView {
  const image = row.image ?? keptImageUrl(address, row.version);
  return row.nft ? { image, nft: { collection: row.nft.collection, tokenId: row.nft.tokenId } } : { image };
}
