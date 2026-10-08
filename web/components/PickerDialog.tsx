"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  /** The dialog's accessible name. */
  label: string;
  title: string;
  /** A line under the title. */
  hint: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The frame of the asset pickers: a dialog that locks page scroll, takes focus, and closes on
 * Escape, the ✕ or a click outside.
 */
export function PickerDialog({ label, title, hint, onClose, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="page-section flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto p-5 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{title}</h2>
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
