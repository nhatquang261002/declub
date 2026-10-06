import type { CSSProperties } from "react";

/**
 * The De(al) Club mark: a red and a blue parenthesis, the two sides of a deal, around a gold coin on a
 * cream tile with a hard shadow, the same sticker style as the cards. Drawn inline so it is crisp at
 * any size and needs no image file.
 * Keep in sync with app/icon.svg (the favicon).
 */
export function LogoMark({ className = "size-10" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 40 40" fill="none">
      <rect x="5" y="5" width="32" height="32" rx="9" fill="#d83b45" />
      <rect x="2" y="2" width="32" height="32" rx="9" fill="#fff4cf" stroke="#111318" strokeWidth="2.5" />
      <g strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 7.5C5 13.5 5 22.5 13 28.5" stroke="#d83b45" />
        <path d="M23 7.5C31 13.5 31 22.5 23 28.5" stroke="#315ea8" />
      </g>
      <circle cx="18" cy="18" r="4.2" fill="#f0b735" stroke="#111318" strokeWidth="2" />
    </svg>
  );
}

const WORDMARK: CSSProperties = {
  fontFamily: "var(--font-brand)",
  letterSpacing: "-0.04em",
  textShadow: "0.06em 0.06em 0 #d83b45",
};

// "(al)" echoes the mark's red and blue parentheses. The pink shadow would swallow the red one, so the
// whole group takes an ink shadow instead, and the blue is lifted to hold up on the dark header.
const GROUP: CSSProperties = { textShadow: "0.06em 0.06em 0 #111318", letterSpacing: "-0.01em", margin: "0 0.04em" };

/**
 * "De(al) Club" in the brand face: white "De", a smaller "(al)" that reads it as "Deal" with the
 * mark's red and blue parentheses around a white "al", gold "Club", pink hard shadow. Screen readers
 * get the plain name from `Logo`.
 */
export function Wordmark({ className = "text-[1.7rem]" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`font-extrabold leading-none ${className}`} style={WORDMARK}>
      <span className="text-white">De</span>
      <span className="text-[0.8em]" style={GROUP}>
        <span className="text-[#ef5a64]">(</span>
        <span className="text-white">al</span>
        <span className="text-[#6f9be0]">)</span>
      </span>{" "}
      <span className="text-[#f0b735]">Club</span>
    </span>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <Wordmark />
      <span className="sr-only">De(al) Club</span>
    </span>
  );
}
