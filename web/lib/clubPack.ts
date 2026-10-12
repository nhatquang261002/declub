import type { Hex } from "viem";
import type { PostImageType } from "./clubPosts";

/**
 * A Club's own emoji and stickers (ADR 0057): small pictures its staff add, which members use in
 * posts by typing `:name:`. The text of a post stays plain text, signed as typed; the shortcode turns
 * into the picture only when it is shown, so a Club that removes one changes how old posts read, and
 * the signed record never depends on a picture. This file is shared by the browser and the server.
 */
export type PackKind = "emoji" | "sticker";

export const PACK_KINDS: readonly PackKind[] = ["emoji", "sticker"];
export const PACK_EMOJI_MAX = 50;
export const PACK_STICKER_MAX = 20;
export const PACK_MAX: Record<PackKind, number> = { emoji: PACK_EMOJI_MAX, sticker: PACK_STICKER_MAX };
/** The most a picture may weigh, decoded. The browser shrinks to the edge below first. */
export const PACK_IMAGE_MAX_BYTES = 256_000;
/** Pictures are scaled down to fit this many pixels on the longer side before they are sent. */
export const PACK_EDGE: Record<PackKind, number> = { emoji: 128, sticker: 512 };

/** A shortcode's name: 2 to 24 lowercase letters, digits or `_`, with a letter in it (so a time like `:30:` is never one). */
export const PACK_NAME = /^(?=[a-z0-9_]*[a-z])[a-z0-9_]{2,24}$/;
const SHORTCODE = /:([a-z0-9_]{2,24}):/g;

/** What the server keeps for each one; the picture is in object storage. */
export type PackEntry = { name: string; kind: PackKind; type: PostImageType; size: number; hash: Hex; at: number; by: string };

/** What a reader gets: enough to draw it. */
export type PackItem = { name: string; kind: PackKind; url: string };

/** Where an entry's picture is served from; `v` changes when it is replaced, so a cached copy isn't shown for the new one. */
export const packImageUrl = (club: string, entry: Pick<PackEntry, "name" | "hash">) =>
  `/api/clubs/${club.toLowerCase()}/pack/${entry.name}?v=${entry.hash.slice(2, 14)}`;

/**
 * The stickers every Club has, without anyone adding them (ADR 0057): static files drawn by
 * `brand/build/stickers.py` into `web/public/stickers`. A Club that adds an emoji or sticker of the
 * same name replaces the built-in one for itself.
 */
export const DEFAULT_STICKER_NAMES = ["gm", "gn", "lfg", "wagmi", "wen", "hodl", "gg", "wtb", "wts", "deal", "gem", "swap"] as const;
export const DEFAULT_STICKERS: readonly PackItem[] = DEFAULT_STICKER_NAMES.map((name) => ({ name, kind: "sticker", url: `/stickers/${name}.svg` }));

/** A Club's own set, then the built-in stickers it hasn't replaced. */
export const withDefaults = (own: readonly PackItem[]): PackItem[] => [...own, ...DEFAULT_STICKERS.filter((d) => !own.some((o) => o.name === d.name))];

export type TextPart = string | PackItem;

/** Whether `text` has anything that could be a shortcode, so a post without one needn't fetch the pack. */
export const mentionsPack = (text: string) => new RegExp(SHORTCODE.source).test(text);

/** `text` cut into plain pieces and the Club's pictures it names; a `:name:` the Club doesn't have stays text. */
export function splitShortcodes(text: string, known: ReadonlyMap<string, PackItem>): TextPart[] {
  const parts: TextPart[] = [];
  let from = 0;
  for (const match of text.matchAll(SHORTCODE)) {
    const item = known.get(match[1]!);
    if (!item) continue;
    if (match.index > from) parts.push(text.slice(from, match.index));
    parts.push(item);
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}
