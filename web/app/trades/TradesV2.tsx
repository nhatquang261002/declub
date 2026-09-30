"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { TradeFilterBar, TradeTabs, type TradeTab } from "@/components/TradeListControls";
import { TradeGridV2 } from "@/components/TradeCardV2";
import { useNow } from "@/hooks/useNow";
import { useTradesTokenInfo } from "@/hooks/useTokenInfo";
import { useTradesV2 } from "@/hooks/useTradesV2";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_FILTERS, isFiltering, type TradeFilters } from "@/lib/tradeFilters";
import { applyTradeFiltersV2 } from "@/lib/tradeFiltersV2";
import type { TradeV2 } from "@/lib/tradesV2";
import { isExpired, sameAddress } from "@/lib/trades";
import { PAGE, SEARCH_LIMIT } from "./TradesV1";

/** The ChogSwapV2 book: any mix of ERC-721, ERC-20 and MON on each side. */
export function TradesV2({ switcher }: { switcher: ReactNode }) {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<TradeTab>("open");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<TradeFilters>(DEFAULT_FILTERS);
  const filtering = isFiltering(filters);
  const limit = filtering ? SEARCH_LIMIT : page * PAGE;
  const { trades, total, hasMore, isLoading, error } = useTradesV2({ limit });
  const { info } = useTradesTokenInfo(trades);

  const lists = useMemo(() => {
    const isLive = (t: TradeV2) => t.status === "open" && !isExpired(t, now);
    const matching = applyTradeFiltersV2(trades, filters, now, info);
    return {
      // Public offers plus private ones addressed to me.
      open: matching.filter((t) => isLive(t) && (!t.taker || sameAddress(t.taker, address))),
      "for-you": matching.filter((t) => isLive(t) && !!address && sameAddress(t.taker, address)),
      all: matching,
    } satisfies Record<TradeTab, TradeV2[]>;
  }, [trades, filters, now, info, address]);

  const currentList = lists[tab];
  const totalPages = Math.max(
    1,
    Math.ceil((filtering ? currentList.length : Number(total)) / PAGE),
  );
  const shown = currentList.slice((page - 1) * PAGE, page * PAGE);

  const updateFilters = (patch: Partial<TradeFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

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
        placeholder="Search NFT ID, token symbol or address, or maker 0x…"
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
            : "No open multi-asset trades yet."}{" "}
          <Link href="/v2/create" className="text-accent underline">
            Create one
          </Link>
        </EmptyState>
      ) : (
        <TradeGridV2 trades={shown} now={now} me={address} info={info} />
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
