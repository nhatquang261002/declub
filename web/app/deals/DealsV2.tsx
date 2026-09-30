"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { DealFilterBar, DealTabs, type DealTab } from "@/components/DealListControls";
import { DealGridV2 } from "@/components/DealCardV2";
import { useNow } from "@/hooks/useNow";
import { useDealsTokenInfo } from "@/hooks/useTokenInfo";
import { useDealsV2 } from "@/hooks/useDealsV2";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_FILTERS, isFiltering, type DealFilters } from "@/lib/dealFilters";
import { applyDealFiltersV2 } from "@/lib/dealFiltersV2";
import type { DealV2 } from "@/lib/dealsV2";
import { isExpired, sameAddress } from "@/lib/deals";
import { PAGE, SEARCH_LIMIT } from "./DealsV1";

/** The ChogSwapV2 book: any mix of ERC-721, ERC-20 and MON on each side. */
export function DealsV2({ switcher }: { switcher: ReactNode }) {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<DealTab>("open");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<DealFilters>(DEFAULT_FILTERS);
  const filtering = isFiltering(filters);
  const limit = filtering ? SEARCH_LIMIT : page * PAGE;
  const { deals, total, hasMore, isLoading, error } = useDealsV2({ limit });
  const { info } = useDealsTokenInfo(deals);

  const lists = useMemo(() => {
    const isLive = (t: DealV2) => t.status === "open" && !isExpired(t, now);
    const matching = applyDealFiltersV2(deals, filters, now, info);
    return {
      // Public offers plus private ones addressed to me.
      open: matching.filter((t) => isLive(t) && (!t.taker || sameAddress(t.taker, address))),
      "for-you": matching.filter((t) => isLive(t) && !!address && sameAddress(t.taker, address)),
      all: matching,
    } satisfies Record<DealTab, DealV2[]>;
  }, [deals, filters, now, info, address]);

  const currentList = lists[tab];
  const totalPages = Math.max(
    1,
    Math.ceil((filtering ? currentList.length : Number(total)) / PAGE),
  );
  const shown = currentList.slice((page - 1) * PAGE, page * PAGE);

  const updateFilters = (patch: Partial<DealFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

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
        placeholder="Search NFT ID, token symbol or address, or maker 0x…"
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
            : "No open multi-asset deals yet."}{" "}
          <Link href="/create" className="text-accent underline">
            Create one
          </Link>
        </EmptyState>
      ) : (
        <DealGridV2 deals={shown} now={now} me={address} info={info} />
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
