import type { CSSProperties } from "react";

/**
 * The De(al) Club mark: a monochrome ink "D" with a dot set into its bowl, on a cream tile. Drawn inline so it is crisp at any size
 * and needs no image file. Keep in sync with app/icon.svg (the favicon).
 */
export function LogoMark({ className = "size-10" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#fff4cf" stroke="#111318" strokeWidth="2.5" />
      <path
        fill="#111318"
        fillRule="evenodd"
        stroke="#111318"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M12.5 10h8c6.500 0 10 4 10 10s-3.500 10-10 10h-8zM17.500 15v10h2.500c3 0 4.800-2 4.800-5s-1.800-5-4.800-5z"
      />
      <circle cx="27" cy="13.5" r="3.4" fill="#fff4cf" stroke="#111318" strokeWidth="2" />
    </svg>
  );
}

const WORDMARK: CSSProperties = {
  fontFamily: "var(--font-brand)",
  letterSpacing: "-0.04em",
};

/**
 * "De(al) Club" in the brand face, one cream colour like the mark: a smaller, dimmed "(al)" reads it
 * as "Deal". Screen readers get the plain name from `Logo`.
 */
export function Wordmark({ className = "text-[1.7rem]" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`font-extrabold leading-none text-[#fff4cf] ${className}`} style={WORDMARK}>
      De<span className="mx-[0.04em] text-[0.8em] opacity-60">(al)</span> Club
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
