"use client";

/** Numbered page buttons with previous / next, shared by the deal lists. */
export function Pagination({
  page,
  totalPages,
  onPage,
  loading,
  nextDisabled,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  loading: boolean;
  /** Extra reason to disable "next", on top of being on the last page. */
  nextDisabled?: boolean;
}) {
  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Deal pages">
      <button
        className="btn-secondary btn-sm"
        onClick={() => onPage(page - 1)}
        disabled={page === 1 || loading}
        aria-label="Previous page"
      >
        <span aria-hidden>←</span>
      </button>
      <div className="tabbar">
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
          <button
            key={pageNumber}
            className="tab min-w-9 !px-2"
            onClick={() => onPage(pageNumber)}
            aria-label={`Go to page ${pageNumber}`}
            aria-current={page === pageNumber ? "page" : undefined}
          >
            {pageNumber}
          </button>
        ))}
      </div>
      <button
        className="btn-secondary btn-sm"
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages || loading || nextDisabled}
        aria-label="Next page"
      >
        <span aria-hidden>→</span>
      </button>
      <span className="basis-full text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Page {page} of {totalPages}
      </span>
    </nav>
  );
}
