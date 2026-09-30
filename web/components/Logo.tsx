import type { CSSProperties } from "react";

/**
 * The On Deal mark: two arrows passing each other on a cream tile with a hard shadow, the same
 * sticker style as the cards. Drawn inline so it is crisp at any size and needs no image file.
 * Keep in sync with app/icon.svg (the favicon).
 */
export function LogoMark({ className = "size-10" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 40 40" fill="none">
      <rect x="5" y="5" width="32" height="32" rx="9" fill="#d83b45" />
      <rect x="2" y="2" width="32" height="32" rx="9" fill="#fff4cf" stroke="#111318" strokeWidth="2.5" />
      <g strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 14.5h16m-5-5 5 5-5 5" stroke="#d83b45" />
        <path d="M27 23.5H11m5-5-5 5 5 5" stroke="#315ea8" />
      </g>
    </svg>
  );
}

const WORDMARK: CSSProperties = {
  fontFamily: "var(--font-brand)",
  letterSpacing: "-0.04em",
  textShadow: "0.06em 0.06em 0 #d83b45",
};

/** "On Deal" in the brand face: white "On", gold "Deal", pink hard shadow. */
export function Wordmark({ className = "text-[1.7rem]" }: { className?: string }) {
  return (
    <span className={`font-extrabold leading-none ${className}`} style={WORDMARK}>
      <span className="text-white">On</span>{" "}
      <span className="text-[#f0b735]">Deal</span>
    </span>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <Wordmark />
      <span className="sr-only">On Deal</span>
    </span>
  );
}
