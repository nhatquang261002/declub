"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { TradeGrid } from "@/components/TradeParts";
import { useNow } from "@/hooks/useNow";
import { useTrades } from "@/hooks/useTrades";
import { errorMessage } from "@/lib/errors";
import {
  DEFAULT_FILTERS,
  applyTradeFilters,
  isFiltering,
  type MonFilter,
  type TradeFilters,
  type TradeSort,
} from "@/lib/tradeFilters";
import { isExpired, sameAddress, type Trade } from "@/lib/trades";

type Tab = "open" | "for-you" | "all";

const PAGE = 4;
/** Searching needs the whole book, not just the pages the reader has opened so far. */
const SEARCH_LIMIT = 200;

const MON_OPTIONS: Array<[MonFilter, string]> = [
  ["any", "Any MON"],
  ["offers-mon", "Offers MON"],
  ["wants-mon", "Wants MON"],
  ["chogs-only", "Chogs only"],
];
const SORT_OPTIONS: Array<[TradeSort, string]> = [
  ["newest", "Newest first"],
  ["ending-soon", "Ending soon"],
];

export default function TradesPage() {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("open");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<TradeFilters>(DEFAULT_FILTERS);
  const filtering = isFiltering(filters);
  const limit = filtering ? SEARCH_LIMIT : page * PAGE;
  const { trades, total, hasMore, isLoading, error } = useTrades({ limit });

  const isLive = (t: Trade) => t.status === "open" && !isExpired(t, now);
  // Public offers plus private ones addressed to me.
  const visibleToMe = (t: Trade) => !t.taker || sameAddress(t.taker, address);

  const matching = applyTradeFilters(trades, filters, now);
  const lists: Record<Tab, Trade[]> = {
    open: matching.filter((t) => isLive(t) && visibleToMe(t)),
    "for-you": matching.filter((t) => isLive(t) && !!address && sameAddress(t.taker, address)),
    all: matching,
  };
  const currentList = lists[tab];
  const totalPages = Math.max(
    1,
    Math.ceil((filtering ? currentList.length : Number(total)) / PAGE),
  );

  const updateFilters = (patch: Partial<TradeFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const shown = currentList.slice((page - 1) * PAGE, page * PAGE);

  return (
    <>
      <PageHeader title="Open trades">
        <div className="flex gap-1 rounded-xl border border-line bg-panel p-1 text-sm">
          {(
            [
              ["open", `Open (${lists.open.length})`],
              ["for-you", `For you (${lists["for-you"].length})`],
              ["all", "All"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 font-medium ${
                tab === key ? "bg-panel-2 text-white" : "text-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="input min-w-52 flex-1"
          placeholder="Search Chog #, trade #, or 0x… maker"
          aria-label="Search trades"
          value={filters.query}
          onChange={(e) => updateFilters({ query: e.target.value })}
        />
        <select
          className="input w-auto!"
          aria-label="Filter by MON"
          value={filters.mon}
          onChange={(e) => updateFilters({ mon: e.target.value as MonFilter })}
        >
          {MON_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          className="input w-auto!"
          aria-label="Sort trades"
          value={filters.sort}
          onChange={(e) => updateFilters({ sort: e.target.value as TradeSort })}
        >
          {SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {filtering && (
          <button type="button" className="btn-secondary" onClick={() => updateFilters(DEFAULT_FILTERS)}>
            Clear
          </button>
        )}
      </div>

      {error ? (
        <EmptyState>
          <span className="text-danger">Couldn&apos;t load trades: {errorMessage(error)}</span>
        </EmptyState>
      ) : isLoading ? (
        <EmptyState>Loading trades…</EmptyState>
      ) : shown.length === 0 && filtering ? (
        <EmptyState>No trades match your search or filters.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState>
          {tab === "for-you"
            ? address
              ? "No private offers addressed to you right now."
              : "Connect a wallet to see offers made to you."
            : "No open trades yet."}{" "}
          <Link href="/create" className="text-accent underline">
            Create one
          </Link>
        </EmptyState>
      ) : (
        <TradeGrid trades={shown} now={now} me={address} />
      )}

      {currentList.length > 0 && (
        <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Trade pages">
          <button
            className="btn-secondary border-[#d83b45] bg-[#d83b45] text-white hover:bg-[#b92f3a] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setPage((current) => current - 1)}
            disabled={page === 1 || isLoading}
            aria-label="Previous page"
          >
            <span aria-hidden>←</span>
          </button>
          <div className="flex items-center gap-1 rounded-xl border border-[#d83b45] bg-[#fff4cf] p-1">
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <button
                key={pageNumber}
                className={`size-9 rounded-lg text-sm font-semibold ${
                  page === pageNumber
                    ? "bg-[#d83b45] text-white"
                    : "text-[#d83b45] hover:bg-[#d83b45] hover:text-white"
                }`}
                onClick={() => setPage(pageNumber)}
                aria-label={`Go to page ${pageNumber}`}
                aria-current={page === pageNumber ? "page" : undefined}
              >
                {pageNumber}
              </button>
            ))}
          </div>
          <button
            className="btn-secondary border-[#d83b45] bg-[#d83b45] text-white hover:bg-[#b92f3a] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setPage((current) => current + 1)}
            disabled={page === totalPages || isLoading || (!hasMore && page >= Math.ceil(trades.length / PAGE))}
            aria-label="Next page"
          >
            <span aria-hidden>→</span>
          </button>
          <span className="basis-full text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Page {page} of {totalPages}
          </span>
        </nav>
      )}
    </>
  );
}
