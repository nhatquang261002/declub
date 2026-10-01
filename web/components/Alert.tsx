"use client";

import { useId, useState, type ReactNode } from "react";
import type { AppError } from "@/lib/errors";

export type AlertTone = "danger" | "warn" | "info" | "success";

/** A rejected wallet prompt is the user's own choice, so it reads as a notice, not a failure. */
export function toneOf(error: AppError): AlertTone {
  return error.kind === "rejected" ? "warn" : "danger";
}

const ICON: Record<AlertTone, ReactNode> = {
  danger: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </>
  ),
  warn: (
    <>
      <path d="M12 4 3 19.5h18L12 4Z" />
      <path d="M12 10v4.2M12 17v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.9v.1" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.8 2.8L16.3 9.6" />
    </>
  ),
};

type AlertProps = {
  tone?: AlertTone;
  title: string;
  children?: ReactNode;
  /** Technical cause, tucked behind a "Details" toggle. */
  details?: string;
  /** Buttons or links under the message (retry, view transaction…). */
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

/**
 * The one look for "something needs your attention": an icon, a short title, one readable
 * sentence, and the technical cause on demand. Fixed light colours so it reads the same on the
 * cream pages and the dark cards. Errors use role="alert" (announced at once); the rest "status".
 */
export function Alert({ tone = "danger", title, children, details, actions, onDismiss, className = "" }: AlertProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className={`alert alert-${tone} ${className}`} role={tone === "danger" ? "alert" : "status"}>
      <svg
        className="alert-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {ICON[tone]}
      </svg>
      <div className="min-w-0 flex-1">
        <p className="alert-title">{title}</p>
        {children && <div className="alert-body">{children}</div>}
        {(actions || details) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {actions}
            {details && (
              <button
                type="button"
                className="alert-link"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((value) => !value)}
              >
                {open ? "Hide details" : "Details"}
              </button>
            )}
          </div>
        )}
        {details && open && (
          <pre id={detailsId} className="alert-details">
            {details}
          </pre>
        )}
      </div>
      {onDismiss && (
        <button type="button" className="alert-close" aria-label="Dismiss" onClick={onDismiss}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
