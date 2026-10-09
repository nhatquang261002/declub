"use client";

import { createPortal } from "react-dom";
import { useModalFocus } from "@/hooks/useModalFocus";

type Props = {
  title: string;
  /** What will happen, in a sentence. */
  message?: string;
  confirmLabel: string;
  /** Red confirm button, for what can't be undone. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A small "are you sure" dialog in place of window.confirm. Escape or a click outside cancels, the
 * cancel button has focus first so Enter never confirms by accident, and Tab stays inside.
 */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const { panel, initial, onKeyDown } = useModalFocus(onCancel);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={message ? "confirm-message" : undefined}
        className="page-section flex w-full max-w-sm flex-col gap-3 p-5"
        onKeyDown={onKeyDown}
      >
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {message && (
          <p id="confirm-message" className="text-sm text-muted">
            {message}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button ref={initial} type="button" className="btn-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`${danger ? "btn-danger" : "btn-primary"} btn-sm`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
