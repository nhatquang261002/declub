"use client";

import type { RefObject } from "react";
import { SmileIcon, StickerIcon } from "@/components/Icons";
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

/**
 * A button that opens a list: `emoji` (the Club's own, then the usual ones) or `sticker` (the Club's
 * own, then the ones every Club has; ADR 0057). A pick goes into `text` where the cursor is in `box`
 * (or at the end), and the cursor stays after it. The Club's pictures go in as `:name:`. Only the
 * composers a member sees draw this, so only members can pick a Club's pictures.
 */
export function EmojiPicker({
  box,
  text,
  setText,
  club,
  kind = "emoji",
  disabled,
  align = "left",
}: {
  box: RefObject<HTMLTextAreaElement | null>;
  text: string;
  setText: (text: string) => void;
  club?: string;
  kind?: PackKind;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const stickers = kind === "sticker";
  const { open, setOpen, ref } = usePopover();
  const { all: pack } = useClubPack(club, open);
  const own = pack.filter((item) => item.kind === kind);

  function add(emoji: string) {
    const area = box.current;
    const [from, to] = area ? [area.selectionStart, area.selectionEnd] : [text.length, text.length];
    setText(text.slice(0, from) + emoji + text.slice(to));
    if (stickers) setOpen(false);
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
        aria-label={stickers ? "Add a sticker" : "Add an emoji"}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {stickers ? <StickerIcon className="size-5" /> : <SmileIcon className="size-5" />}
      </button>
      {open && (
        <div className={`emoji-pop ${align === "right" ? "emoji-pop-right" : ""}`} role="group" aria-label={stickers ? "Stickers" : "Emoji"}>
          {own.length > 0 && (
            <div>
              <p className="emoji-label">{stickers ? "Stickers" : "This Club’s emoji"}</p>
              <div className={`emoji-grid ${stickers ? "emoji-grid-stickers" : ""}`}>
                {own.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className={`emoji-btn ${stickers ? "emoji-btn-sticker" : ""}`}
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
          )}
          {(stickers ? [] : GROUPS).map((group) => (
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
