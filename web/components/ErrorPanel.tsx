"use client";

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { describeError } from "@/lib/errors";

function WarningIcon() {
  return (
    <svg
      className="size-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4 3 19.5h18L12 4Z" />
      <path d="M12 10v4.2M12 17v.1" />
    </svg>
  );
}

type ErrorPanelProps = {
  /** What failed, in the user's terms: "Couldn't load deals". */
  title: string;
  /** Overrides the sentence taken from `error`. */
  message?: string;
  /** Raw cause, shown behind a "Details" toggle. */
  details?: string;
  onRetry?: () => void | Promise<unknown>;
  retryLabel?: string;
  children?: ReactNode;
};

/** A full-width "this didn't load" state with a way forward, in place of a line of red text. */
export function ErrorPanel({ title, message, details, onRetry, retryLabel = "Try again", children }: ErrorPanelProps) {
  const [retrying, setRetrying] = useState(false);
  const [open, setOpen] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry?.();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="page-section error-panel" role="alert">
      <span className="error-panel-icon">
        <WarningIcon />
      </span>
      <h2 className="text-lg font-extrabold">{title}</h2>
      {message && <p className="max-w-md text-sm text-muted">{message}</p>}
      {children}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <button type="button" className="btn-primary" disabled={retrying} onClick={retry}>
            {retrying ? "Retrying…" : retryLabel}
          </button>
        )}
        {details && (
          <button type="button" className="text-xs font-bold underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide details" : "Details"}
          </button>
        )}
      </div>
      {details && open && <pre className="alert-details mt-2 w-full max-w-md text-left">{details}</pre>}
    </div>
  );
}

/** The usual case: a query failed. Retrying refetches whatever is on the page. */
export function LoadError({ title, error }: { title: string; error: unknown }) {
  const queryClient = useQueryClient();
  const described = describeError(error);
  return (
    <ErrorPanel
      title={title}
      message={described.message}
      details={described.details}
      onRetry={() => queryClient.invalidateQueries()}
    />
  );
}
