"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { DealFilterBar, DealTabs, type DealTab } from "@/components/DealListControls";
import { ListingGrid } from "@/components/IntentParts";
import { Select, type SelectOption } from "@/components/Select";
import { useNow } from "@/hooks/useNow";
import { useIntents } from "@/hooks/usePool";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useDealsV2 } from "@/hooks/useDealsV2";
import { erc20Tokens } from "@/lib/assets";
import { swapIntents } from "@/lib/contracts";
import { errorMessage } from "@/lib/errors";
import { intentAsListing } from "@/lib/intents";
import { DEFAULT_FILTERS, isFiltering, type DealFilters } from "@/lib/dealFilters";
import { applyDealFiltersV2 } from "@/lib/dealFiltersV2";
import type { DealV2 } from "@/lib/dealsV2";
import { isExpired, sameAddress } from "@/lib/deals";
import { PAGE, SEARCH_LIMIT } from "./DealsV1";
import { CreateDealButton } from "@/components/CreateDealButton";

/** Which settlement to show: both, deals with locked assets, or signed swaps (ADR 0008). */
type KindFilter = "any" | "locked" | "signed";
const KIND_OPTIONS: Array<SelectOption<KindFilter>> = [
  { value: "any", label: "All types" },
  { value: "locked", label: "Locked" },
  { value: "signed", label: "Signed" },
];

/**
 * The multi-asset book: ChogSwapV2 deals (locked) and, when the intents contract is configured,
 * signed swaps from the pool, in one list. Any mix of ERC-721 and ERC-20 on each side, plus MON
 * on locked deals.
 */
export function DealsV2({ switcher }: { switcher: ReactNode }) {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<DealTab>("open");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<DealFilters>(DEFAULT_FILTERS);
  const [kind, setKind] = useState<KindFilter>("any");
  const filtering = isFiltering(filters) || kind !== "any";
  const limit = filtering ? SEARCH_LIMIT : page * PAGE;
  const showLocked = kind !== "signed";
  const showSigned = !!swapIntents && kind !== "locked";
  const { deals, total, hasMore, isLoading: dealsLoading, error } = useDealsV2({ limit, enabled: showLocked });

  // The pool being down only costs the signed swaps: locked deals read straight from the chain.
  const openSigned = useIntents({ status: "open", enabled: showSigned });
  const allSigned = useIntents({ status: "all", enabled: showSigned && tab === "all" });
  const signedListings = useMemo(
    () => ({
      open: showSigned ? openSigned.intents.map(intentAsListing) : [],
      all: showSigned ? (tab === "all" ? allSigned.intents : openSigned.intents).map(intentAsListing) : [],
    }),
    [showSigned, tab, openSigned.intents, allSigned.intents],
  );

  const isLoading = dealsLoading || (showSigned && openSigned.isLoading);

  const tokens = useMemo(
    () =>
      erc20Tokens(
        [...deals, ...signedListings.all, ...signedListings.open].flatMap((t) => [...t.offered, ...t.requested]),
      ),
    [deals, signedListings],
  );
  const { info } = useTokenInfo(tokens);

  const lists = useMemo(() => {
    const isLive = (t: DealV2) => t.status === "open" && !isExpired(t, now);
    // Signed swaps first: they carry no timestamp or id to order them against deals by, and
    // "Ending soon" re-sorts the two together anyway.
    const live = applyDealFiltersV2([...signedListings.open, ...deals], filters, now, info);
    const everything = applyDealFiltersV2([...signedListings.all, ...deals], filters, now, info);
    return {
      // Public offers plus private ones addressed to me. A signed swap is open to any counterparty.
      open: live.filter((t) => isLive(t) && (!t.taker || sameAddress(t.taker, address))),
      // Only a locked deal can be addressed to one wallet.
      "for-you": live.filter((t) => isLive(t) && !!address && sameAddress(t.taker, address)),
      all: everything,
    } satisfies Record<DealTab, DealV2[]>;
  }, [deals, signedListings, filters, now, info, address]);

  const currentList = lists[tab];
  const signedInTab = tab === "for-you" ? 0 : (tab === "all" ? signedListings.all : signedListings.open).length;
  const totalPages = Math.max(
    1,
    Math.ceil((filtering ? currentList.length : Number(total) + signedInTab) / PAGE),
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
          <CreateDealButton />
        </div>
      </PageHeader>

      <DealFilterBar
        filters={filters}
        onChange={updateFilters}
        placeholder="Search NFT ID, token symbol or address, or maker 0x…"
        extra={
          swapIntents && (
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

      {showSigned && openSigned.error && (
        <p className="mb-5 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn" role="status">
          Signed swaps are unavailable right now: {errorMessage(openSigned.error)}
        </p>
      )}

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
        <ListingGrid listings={shown} now={now} me={address} info={info} />
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
