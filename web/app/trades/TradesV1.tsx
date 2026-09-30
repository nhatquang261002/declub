"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { TradeFilterBar, TradeTabs, type TradeTab } from "@/components/TradeListControls";
import { TradeGrid } from "@/components/TradeParts";
import { useNow } from "@/hooks/useNow";
import { useTrades } from "@/hooks/useTrades";
import { useTradeTraits } from "@/hooks/useTraits";
import { errorMessage } from "@/lib/errors";
import {
  DEFAULT_FILTERS,
  applyTradeFilters,
  isFiltering,
  traitSuggestions,
  type TradeFilters,
} from "@/lib/tradeFilters";
import { isExpired, sameAddress, type Trade } from "@/lib/trades";

export const PAGE = 4;
/** Searching needs the whole book, not just the pages the reader has opened so far. */
export const SEARCH_LIMIT = 200;

/** The ChogSwap (v1) book: Chogs and MON, plus trait requests. */
export function TradesV1({ switcher }: { switcher: ReactNode }) {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<TradeTab>("open");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<TradeFilters>(DEFAULT_FILTERS);
  const filtering = isFiltering(filters);
  const limit = filtering ? SEARCH_LIMIT : page * PAGE;
  const { trades, total, hasMore, isLoading, error } = useTrades({ limit });

  const isLive = (t: Trade) => t.status === "open" && !isExpired(t, now);
  // Public offers plus private ones addressed to me.
  const visibleToMe = (t: Trade) => !t.taker || sameAddress(t.taker, address);

  const traits = useTradeTraits(trades);
  const matching = applyTradeFilters(trades, filters, now, traits);
  const lists: Record<TradeTab, Trade[]> = {
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
        <div className="flex flex-wrap items-center gap-2">
          {switcher}
          <TradeTabs
            tab={tab}
            onTab={(next) => {
              setTab(next);
              setPage(1);
            }}
            openCount={lists.open.length}
            forYouCount={lists["for-you"].length}
          />
        </div>
      </PageHeader>

      <TradeFilterBar
        filters={filters}
        onChange={updateFilters}
        placeholder="Search asset ID, trait, or maker 0x…"
        suggestions={traitSuggestions(trades, traits)}
      />

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
        <TradeGrid trades={shown} now={now} me={address} traitLabels={traits.byRoot} />
      )}

      {currentList.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPage={setPage}
          loading={isLoading}
          nextDisabled={!hasMore && page >= Math.ceil(trades.length / PAGE)}
        />
      )}
    </>
  );
}
