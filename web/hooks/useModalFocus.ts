"use client";

import { useEffect, useRef } from "react";

/**
 * The keyboard and focus behavior of a modal dialog: page scroll is locked, `initial` (attach it
 * to the button that should have focus first) takes focus, Escape calls `onClose`, Tab stays
 * between the panel's buttons, and focus goes back to what opened it. Attach `panel` and
 * `onKeyDown` to the dialog element.
 */
export function useModalFocus(onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const initial = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    const opener = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    initial.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return { panel, initial, onKeyDown };
}
