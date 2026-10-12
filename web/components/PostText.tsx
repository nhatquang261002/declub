"use client";

import { useClubPack } from "@/hooks/useClubBoard";
import { mentionsPack, splitShortcodes } from "@/lib/clubPack";

/**
 * A post's text with its Club's own emoji and stickers drawn where it names them as `:name:` (ADR
 * 0057). The text is still only text: React escapes it, and a `:name:` the Club doesn't have, or has
 * since removed, stays as typed. A post that is nothing but one of them shows it large.
 */
export function PostText({ club, text, className }: { club: string; text: string; className?: string }) {
  const { byName } = useClubPack(club, mentionsPack(text));
  const parts = splitShortcodes(text, byName);
  const alone = parts.length === 1 && typeof parts[0] !== "string";
  return (
    <p className={className}>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            className={`club-${part.kind} ${alone ? "club-big" : ""}`}
            src={part.url}
            alt={`:${part.name}:`}
            title={`:${part.name}:`}
            loading="lazy"
          />
        ),
      )}
    </p>
  );
}
