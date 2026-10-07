/**
 * What a signed-in user says about themselves on their profile page (ADR 0042): a display name and
 * a short bio. Like the avatar (ADR 0028) it belongs to the user and shows on every wallet linked
 * to their sign-in. It is plain text and is never checked, so the app never uses it to say who
 * someone is: deals, posts and lists keep showing the verified X / Discord handle and the address.
 * This file is shared by the browser and the server.
 */
import type { AvatarView } from "./avatars";
import type { Profile } from "./profiles";

export type About = { name?: string; bio?: string };

/** What the server keeps for each wallet. The same row is written for each of the user's wallets. */
export type StoredAbout = About & { userId: string; updatedAt: number };

export const NAME_MAX = 32;
export const BIO_MAX = 160;

export const aboutKey = (address: string) => `declub:about:${address.toLowerCase()}`;
export const aboutWalletsKey = (userId: string) => `declub:about-user:${userId}`;

// Controls, zero-width characters and bidirectional overrides: none of them is text, and the last
// can make one name read as another.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

const length = (text: string) => Array.from(text).length;

export type AboutResult = { ok: true; about: About } | { ok: false; message: string };

/**
 * A name and bio as they will be kept, or why they can't be. The name is one line; the bio keeps
 * its line breaks, at most two in a row. Blank fields are dropped, so an empty `about` means
 * "nothing to show".
 */
export function cleanAbout(input: unknown): AboutResult {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const { name: rawName, bio: rawBio } = body;
  if ((rawName !== undefined && typeof rawName !== "string") || (rawBio !== undefined && typeof rawBio !== "string")) {
    return { ok: false, message: "Write the name and bio as text." };
  }
  const name = (rawName ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const bio = (rawBio ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (length(name) > NAME_MAX) return { ok: false, message: `Keep the name to ${NAME_MAX} characters.` };
  if (length(bio) > BIO_MAX) return { ok: false, message: `Keep the bio to ${BIO_MAX} characters.` };
  return { ok: true, about: { ...(name ? { name } : {}), ...(bio ? { bio } : {}) } };
}

/** Whether there is anything to show. */
export const hasAbout = (about: About | null | undefined): about is About => !!about && (!!about.name || !!about.bio);

/** What `/api/wallets/[address]/profile` says about a wallet: only what its owner chose to show. */
export type WalletProfile = {
  enabled: boolean;
  /** The X or Discord handle its owner chose to show beside the wallet (ADR 0011). */
  profile: Profile | null;
  avatar: AvatarView | null;
  about: About | null;
};

/** A Club a wallet is listed in, as its Members list shows it. */
export type WalletClub = { token: string; holder: boolean; joinedAt: number };

/** A wallet's public page. */
export const profilePath = (address: string) => `/profile/${address.toLowerCase()}`;
