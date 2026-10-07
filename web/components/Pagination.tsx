"use client";

import { useRef, useState } from "react";

/** Numbered page buttons with previous / next, and a page number to type, shared by the deal lists. */
export function Pagination({
  page,
  totalPages,
  onPage,
  loading,
  nextDisabled,
  label = "Deal pages",
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  loading: boolean;
  /** Extra reason to disable "next", on top of being on the last page. */
  nextDisabled?: boolean;
  /** What the pages are of, for screen readers. */
  label?: string;
}) {
  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label={label}>
      <button
        className="btn-secondary btn-sm"
        onClick={() => onPage(page - 1)}
        disabled={page === 1 || loading}
        aria-label="Previous page"
      >
        <span aria-hidden>←</span>
      </button>
      <div className="tabbar">
        {pageList(page, totalPages).map((entry, i) =>
          entry === null ? (
            <span key={`gap-${i}`} className="grid min-w-6 place-items-center text-muted" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={entry}
              className="tab min-w-9 !px-2"
              onClick={() => onPage(entry)}
              aria-label={`Go to page ${entry}`}
              aria-current={page === entry ? "page" : undefined}
            >
              {entry}
            </button>
          ),
        )}
      </div>
      <button
        className="btn-secondary btn-sm"
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages || loading || nextDisabled}
        aria-label="Next page"
      >
        <span aria-hidden>→</span>
      </button>
      <PageJump page={page} totalPages={totalPages} onPage={onPage} disabled={loading} />
    </nav>
  );
}

/** The first and last page and the ones around `page`, with `null` where a run is left out. Few pages are all shown. */
function pageList(page: number, totalPages: number): Array<number | null> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const shown = new Set([1, totalPages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= totalPages));
  const sorted = [...shown].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(n - sorted[i - 1] === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}

/**
 * "Page [3] of 12", where the number is an input: type a page and press Enter (or leave the
 * field) to go there. Out-of-range numbers clamp to the first or last page; anything else snaps back.
 */
function PageJump({
  page,
  totalPages,
  onPage,
  disabled,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  disabled: boolean;
}) {
  // What's typed, while it's being typed; otherwise the field shows the current page.
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs the field too; this keeps that blur from jumping to what was typed.
  const cancelled = useRef(false);

  function go() {
    const typed = Number(draft);
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft === null || draft.trim() === "" || !Number.isInteger(typed)) return;
    const target = Math.min(Math.max(typed, 1), totalPages);
    if (target !== page) onPage(target);
  }

  return (
    <form
      className="flex basis-full items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label htmlFor="page-jump">Page</label>
      <input
        id="page-jump"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        disabled={disabled || totalPages <= 1}
        value={draft ?? String(page)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onFocus={(e) => e.target.select()}
        onBlur={go}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        title={`Type a page from 1 to ${totalPages} and press Enter`}
        aria-label={`Go to page, 1 to ${totalPages}`}
        className="rounded-lg border-2 border-[#111318] bg-white px-1 py-0.5 text-center text-sm font-black tracking-normal text-[#111318] tabular-nums outline-none focus:border-[var(--chog-pink-500)] disabled:opacity-60"
        style={{ width: `${Math.max(2, String(totalPages).length) + 1.5}ch` }}
      />
      <span>of {totalPages}</span>
    </form>
  );
}
