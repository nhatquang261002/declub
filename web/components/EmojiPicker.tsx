"use client";

import type { RefObject } from "react";
import { SmileIcon } from "@/components/Icons";
import { usePopover } from "@/components/Popover";
import { useClubPack } from "@/hooks/useClubBoard";
import type { PackKind } from "@/lib/clubPack";

/**
 * A short list of emoji to drop into a post (ADR 0056). Each is one code point, so it counts as one
 * character toward the post's limit; the system picker still works for anything else.
 */
const GROUPS: { label: string; emoji: string[] }[] = [
  {
    label: "Faces",
    emoji: ["😀", "😁", "😂", "🤣", "😊", "😍", "😎", "🤩", "🥳", "😅", "😉", "🙂", "🤔", "😬", "😴", "😭", "😡", "🥺", "😱", "🤯", "🤑", "🫡"],
  },
  { label: "Hands", emoji: ["👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "🤝", "👋", "🤞", "🫶"] },
  { label: "Marks", emoji: ["🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "🔥", "✨", "⭐", "⚡", "🎉", "🎁", "🏆"] },
  { label: "Deals", emoji: ["💎", "🚀", "💰", "🪙", "🔑", "🛒", "📈", "📉", "🐸", "🐶", "🐱", "🦊", "🐻", "🦄", "🐢"] },
];

const CLUB_GROUPS: { kind: PackKind; label: string }[] = [
  { kind: "emoji", label: "This Club’s emoji" },
  { kind: "sticker", label: "Stickers" },
];

/**
 * A smiley button that opens the list. A pick goes into `text` where the cursor is in `box` (or at
 * the end), and the cursor stays after it. The stickers every Club has, and with `club` its own emoji
 * and stickers, come first (ADR 0057); they go in as `:name:`.
 */
export function EmojiPicker({
  box,
  text,
  setText,
  club,
  disabled,
  align = "left",
}: {
  box: RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: (text: string) => void;
  club?: string;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const { open, setOpen, ref } = usePopover();
  const { all: pack } = useClubPack(club, open);

  function add(emoji: string) {
    const area = box.current;
    const [from, to] = area ? [area.selectionStart, area.selectionEnd] : [text.length, text.length];
    setText(text.slice(0, from) + emoji + text.slice(to));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(from + emoji.length, from + emoji.length);
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="icon-btn"
        aria-label="Add an emoji"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <SmileIcon className="size-5" />
      </button>
      {open && (
        <div className={`emoji-pop ${align === "right" ? "emoji-pop-right" : ""}`} role="group" aria-label="Emoji">
          {CLUB_GROUPS.map(({ kind, label }) => {
            const own = pack.filter((item) => item.kind === kind);
            return (
              own.length > 0 && (
                <div key={kind}>
                  <p className="emoji-label">{label}</p>
                  <div className={`emoji-grid ${kind === "sticker" ? "emoji-grid-stickers" : ""}`}>
                    {own.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        className={`emoji-btn ${kind === "sticker" ? "emoji-btn-sticker" : ""}`}
                        aria-label={`:${item.name}:`}
                        title={`:${item.name}:`}
                        onClick={() => add(`:${item.name}:`)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.url} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </div>
              )
            );
          })}
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="emoji-label">{group.label}</p>
              <div className="emoji-grid">
                {group.emoji.map((emoji) => (
                  <button key={emoji} type="button" className="emoji-btn" aria-label={emoji} onClick={() => add(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
