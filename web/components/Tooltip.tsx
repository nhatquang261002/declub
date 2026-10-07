"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A small explanation on a word or chip. Opens on hover or keyboard focus, and on tap for touch
 * screens; closes on Escape, on a tap elsewhere, and when focus leaves. Moving the pointer onto
 * the bubble keeps it open, so its "Learn more" link can be clicked. The trigger is a button, so
 * don't put a Tooltip inside another button or link.
 */
export function Tooltip({
  children,
  content,
  href,
  linkText = "Learn more",
  className = "",
}: {
  /** What the reader points at. */
  children: ReactNode;
  content: ReactNode;
  /** Where "Learn more" goes, e.g. a Guide anchor. Omit for a tip with no link. */
  href?: string;
  linkText?: string;
  className?: string;
}) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  // Slide the bubble to the right edge of the trigger when it would run off-screen.
  const [alignEnd, setAlignEnd] = useState(false);

  useEffect(() => {
    if (!open) return;
    const rect = root.current?.getBoundingClientRect();
    if (rect) setAlignEnd(rect.left + 272 > window.innerWidth - 8);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={`relative inline-flex ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        className="cursor-help rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {children}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-30 mt-2 w-64 max-w-[calc(100vw-1rem)] rounded-lg border-2 border-[#111318] bg-[#fff4cf] p-3 text-left font-sans text-xs leading-5 font-medium tracking-normal text-[#111318] normal-case ${
            alignEnd ? "right-0" : "left-0"
          }`}
        >
          {content}
          {href && (
            <>
              {" "}
              <Link href={href} className="font-semibold whitespace-nowrap text-[#a9282f] underline">
                {linkText} →
              </Link>
            </>
          )}
        </span>
      )}
    </span>
  );
}
