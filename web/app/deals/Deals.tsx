"use client";

import { useEffect, useState } from "react";
import { useConnection } from "wagmi";
import { Alert } from "@/components/Alert";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState, PageHeader } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { DealFilterBar, DealTabs } from "@/components/DealListControls";
import { ListingGrid } from "@/components/IntentParts";
import { Select, type SelectOption } from "@/components/Select";
import { useNow } from "@/hooks/useNow";
import { useDealBook } from "@/hooks/useDealBook";
import { useDealsTokenInfo } from "@/hooks/useTokenInfo";
import { SHOW_INTENTS } from "@/lib/config";
import type { BookKind, DealTab } from "@/lib/dealBook";
import { DEFAULT_FILTERS, isFiltering, type DealFilters } from "@/lib/dealFilters";
import { CreateDealButton } from "@/components/CreateDealButton";

const PAGE = 12;
/** Typing waits this long before it asks the server, so a search isn't sent per keystroke. */
const SEARCH_DELAY_MS = 250;

const KIND_OPTIONS: Array<SelectOption<BookKind>> = [
  { value: "any", label: "All types" },
  { value: "locked", label: "Locked" },
  { value: "signed", label: "Signed" },
];

/**
 * The deal book: DeClubEscrow deals (locked) and, when the intents contract is configured, signed swaps
 * from the pool, in one list. Any mix of ERC-721 and ERC-20 on each side, plus MON on locked deals.
 * The server searches, filters and pages the whole book (ADR 0020); this page only shows a page.
 */
export function Deals() {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<DealTab>("open");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<DealFilters>(DEFAULT_FILTERS);
  const [kind, setKind] = useState<BookKind>("any");
  const query = useDebounced(filters.query, SEARCH_DELAY_MS);
  const filtering = isFiltering(filters) || kind !== "any";

  const book = useDealBook({
    tab,
    filters: { ...filters, query },
    kind: SHOW_INTENTS ? kind : "locked",
    viewer: address,
    tokens: [],
    page,
    size: PAGE,
  });
  const { items, total, counts, signedError, isLoading, error } = book;
  const { info } = useDealsTokenInfo(items);
  const totalPages = Math.max(1, Math.ceil(total / PAGE));

  const updateFilters = (patch: Partial<DealFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Open deals">
        <div className="flex flex-wrap items-center gap-2">
          <DealTabs
            tab={tab}
            onTab={(next) => {
              setTab(next);
              setPage(1);
            }}
            openCount={counts.open}
            forYouCount={counts.forYou}
          />
          <CreateDealButton />
        </div>
      </PageHeader>

      <DealFilterBar
        filters={filters}
        onChange={updateFilters}
        placeholder="Collection, token, NFT ID or maker 0x…"
        extra={
          SHOW_INTENTS && (
            <Select
              className="w-auto"
              aria-label="Filter by deal type"
              value={kind}
              options={KIND_OPTIONS}
              onChange={(next) => {
                setKind(next);
                setPage(1);
              }}
            />
          )
        }
      />

      {signedError && (
        <Alert tone="warn" title="Signed swaps are unavailable right now" className="mb-5">
          {signedError} Deals you can accept on-chain are still listed below.
        </Alert>
      )}

      {error && items.length === 0 ? (
        <LoadError title="Couldn't load deals" error={error} />
      ) : !book.enabled ? (
        <EmptyState>Deals aren&apos;t enabled on this deployment yet.</EmptyState>
      ) : isLoading ? (
        <EmptyState>Loading deals…</EmptyState>
      ) : items.length === 0 && filtering ? (
        <EmptyState>No deals match your search or filters.</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>
          <p>
            {tab === "for-you"
              ? address
                ? "No private offers addressed to you right now."
                : "Connect a wallet to see offers made to you."
              : "No open deals yet."}
          </p>
          <CreateDealButton className="mt-5" />
        </EmptyState>
      ) : (
        <ListingGrid listings={items} now={now} me={address} info={info} />
      )}

      {total > 0 && <Pagination page={page} totalPages={totalPages} onPage={setPage} loading={isLoading || book.isFetching} />}
    </>
  );
}

/** `value`, once it has stopped changing for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
