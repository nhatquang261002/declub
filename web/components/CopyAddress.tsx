"use client";

import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";

import { CheckIcon, CopyIcon } from "@/components/Icons";
import { shortAddress } from "@/lib/format";

/** Copies text to the clipboard, and reports `copied` for a moment afterwards. */
export function useCopy(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {},
    );
  }, []);
  return [copied, copy];
}

/**
 * An address that copies itself: click it (or its icon) and the whole 0x… address goes to the
 * clipboard, whichever way it is spelled on screen. `full` spells the address out, `children`
 * replaces the text (a collection's name, say) while still copying the address.
 *
 * `inLink` is for places already inside a link or a button (a deal card), where a nested
 * <button> would be invalid and the click would also follow the link: it renders a focusable
 * span that stops the click from reaching it.
 */
export function CopyAddress({
  address,
  full = false,
  iconOnly = false,
  inLink = false,
  label = "Copy address",
  className = "",
  children,
}: {
  address: string;
  full?: boolean;
  /** Just the copy icon, for an address that is already shown (as a link to the explorer). */
  iconOnly?: boolean;
  inLink?: boolean;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, copy] = useCopy();
  const text = label === "Copy address" ? `Copy ${address}` : label;
  const props = {
    title: copied ? "Copied" : text,
    "aria-label": copied ? "Copied" : text,
    className: `copy-address ${className}`,
  };
  const body = (
    <>
      {!iconOnly && <span className={full ? "break-all" : undefined}>{children ?? (full ? address : shortAddress(address))}</span>}
      {copied ? <CheckIcon className="size-[1.1em] shrink-0 text-[#1f7a55]" /> : <CopyIcon className="size-[1.1em] shrink-0 opacity-60" />}
    </>
  );

  if (!inLink) {
    return (
      <button type="button" {...props} onClick={() => copy(address)}>
        {body}
      </button>
    );
  }
  const run = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    copy(address);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      {...props}
      onClick={run}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") run(event);
      }}
    >
      {body}
    </span>
  );
}
