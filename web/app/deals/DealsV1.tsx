"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { DealFilterBar, DealTabs, type DealTab } from "@/components/DealListControls";
import { DealGrid } from "@/components/DealParts";
import { useNow } from "@/hooks/useNow";
import { useDeals } from "@/hooks/useDeals";
import { useDealTraits } from "@/hooks/useTraits";
import { errorMessage } from "@/lib/errors";
import {
  DEFAULT_FILTERS,
  applyDealFilters,
  isFiltering,
  traitSuggestions,
  type DealFilters,
} from "@/lib/dealFilters";
import { isExpired, sameAddress, type Deal } from "@/lib/deals";

export const PAGE = 4;
/** Searching needs the whole book, not just the pages the reader has opened so far. */
export const SEARCH_LIMIT = 200;

/** The ChogSwap (v1) book: Chogs and MON, plus trait requests. */
export function DealsV1({ switcher }: { switcher: ReactNode }) {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<DealTab>("open");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<DealFilters>(DEFAULT_FILTERS);
  const filtering = isFiltering(filters);
  const limit = filtering ? SEARCH_LIMIT : page * PAGE;
  const { deals, total, hasMore, isLoading, error } = useDeals({ limit });

  const isLive = (t: Deal) => t.status === "open" && !isExpired(t, now);
  // Public offers plus private ones addressed to me.
  const visibleToMe = (t: Deal) => !t.taker || sameAddress(t.taker, address);

  const traits = useDealTraits(deals);
  const matching = applyDealFilters(deals, filters, now, traits);
  const lists: Record<DealTab, Deal[]> = {
    open: matching.filter((t) => isLive(t) && visibleToMe(t)),
    "for-you": matching.filter((t) => isLive(t) && !!address && sameAddress(t.taker, address)),
    all: matching,
  };
  const currentList = lists[tab];
  const totalPages = Math.max(
    1,
    Math.ceil((filtering ? currentList.length : Number(total)) / PAGE),
  );

  const updateFilters = (patch: Partial<DealFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const shown = currentList.slice((page - 1) * PAGE, page * PAGE);

  return (
    <>
      <PageHeader title="Open deals">
        <div className="flex flex-wrap items-center gap-2">
          {switcher}
          <DealTabs
            tab={tab}
            onTab={(next) => {
              setTab(next);
              setPage(1);
            }}
            openCount={lists.open.length}
            forYouCount={lists["for-you"].length}
          />
          <Link href="/create" className="btn-primary">
            Create deal
          </Link>
        </div>
      </PageHeader>

      <DealFilterBar
        filters={filters}
        onChange={updateFilters}
        placeholder="Search asset ID, trait, or maker 0x…"
        suggestions={traitSuggestions(deals, traits)}
      />

      {error ? (
        <EmptyState>
          <span className="text-danger">Couldn&apos;t load deals: {errorMessage(error)}</span>
        </EmptyState>
      ) : isLoading ? (
        <EmptyState>Loading deals…</EmptyState>
      ) : shown.length === 0 && filtering ? (
        <EmptyState>No deals match your search or filters.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState>
          {tab === "for-you"
            ? address
              ? "No private offers addressed to you right now."
              : "Connect a wallet to see offers made to you."
            : "No open deals yet."}{" "}
          <Link href="/create" className="text-accent underline">
            Create one
          </Link>
        </EmptyState>
      ) : (
        <DealGrid deals={shown} now={now} me={address} traitLabels={traits.byRoot} />
      )}

      {currentList.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPage={setPage}
          loading={isLoading}
          nextDisabled={!hasMore && page >= Math.ceil(deals.length / PAGE)}
        />
      )}
    </>
  );
}
