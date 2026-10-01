"use client";

import { useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState, PageHeader } from "@/components/Page";
import { ListingGrid } from "@/components/IntentParts";
import { DealGrid } from "@/components/DealParts";
import { Tabs } from "@/components/Tabs";
import { VersionSwitch, type DealVersion } from "@/components/VersionSwitch";
import { useLocalFills } from "@/hooks/useLocalFills";
import { useNow } from "@/hooks/useNow";
import { useDealsTokenInfo } from "@/hooks/useTokenInfo";
import { useDeals } from "@/hooks/useDeals";
import { useDealsV2 } from "@/hooks/useDealsV2";
import { useIntents } from "@/hooks/usePool";
import { CHOG_SWAP_ADDRESS, CHOG_SWAP_V2_ADDRESS } from "@/lib/config";
import { swapIntents, swapV2 } from "@/lib/contracts";
import { intentAsListing } from "@/lib/intents";
import { displayStatus, sameAddress, type DisplayStatus, type Deal } from "@/lib/deals";
import type { DealV2 } from "@/lib/dealsV2";
import { CreateDealButton } from "@/components/CreateDealButton";

type HistoryFilter = "all" | "active" | "completed" | "expired";

const FILTERS: Array<[HistoryFilter, string]> = [
  ["all", "All activity"],
  ["active", "Active"],
  ["completed", "Completed"],
  ["expired", "Expired"],
];

export default function HistoryPage() {
  const { address } = useConnection();
  const now = useNow();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [version, setVersion] = useState<DealVersion>(swapV2 && swapIntents ? "v2" : "v1");
  const isV2 = version === "v2";
  const v1 = useDeals({ limit: 200, enabled: !isV2 });
  const v2 = useDealsV2({ limit: 200, enabled: isV2 });
  // Signed swaps (ADR 0008) sit beside locked deals in the multi-asset view, every status.
  const signed = useIntents({ status: "all", maker: address, enabled: isV2 && !!swapIntents && !!address });
  const signedListings = useMemo(() => signed.intents.map(intentAsListing), [signed.intents]);
  const v2Deals = useMemo(() => [...signedListings, ...v2.deals], [signedListings, v2.deals]);
  const { info } = useDealsTokenInfo(v2Deals);
  // Fills are remembered per contract, so each version reads its own record.
  const v1Fills = useLocalFills(address, CHOG_SWAP_ADDRESS);
  const v2Fills = useLocalFills(address, CHOG_SWAP_V2_ADDRESS ?? CHOG_SWAP_ADDRESS);
  const { error } = isV2 ? v2 : v1;
  const isLoading = (isV2 ? v2.isLoading || signed.isLoading : v1.isLoading) && !error;
  const deals: Array<Deal | DealV2> = isV2 ? v2Deals : v1.deals;
  const localFillIds = isV2 ? v2Fills.ids : v1Fills.ids;

  const walletDeals = useMemo(
    () => deals.filter((deal) => isWalletDeal(deal, address, localFillIds)),
    [address, localFillIds, deals],
  );
  const statuses = useMemo(
    () => walletDeals.map((deal) => displayStatus(deal, now)),
    [now, walletDeals],
  );
  const counts = useMemo(
    () => ({
      active: statuses.filter((status) => status === "open").length,
      completed: statuses.filter((status) => status === "filled").length,
      expired: statuses.filter((status) => status === "expired").length,
    }),
    [statuses],
  );
  const visibleDeals = useMemo(
    () =>
      filter === "all"
        ? walletDeals
        : walletDeals.filter((deal) => displayStatus(deal, now) === filterStatus(filter)),
    [filter, now, walletDeals],
  );

  return (
    <div className="space-y-10">
      <section className="hero-panel overflow-hidden">
        <div className="grid gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="eyebrow">Your deal journal</div>
            <h1 className="mt-5 max-w-2xl text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
              Every deal,
              <span className="block text-accent">all in one place.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
              Keep an eye on offers, swaps, and expired deals involving your wallet.
            </p>
          </div>
          <div className="rounded-2xl border-2 border-[#111318] bg-[#fff4cf] p-5 text-[#111318] shadow-[0.3rem_0.3rem_0_#111318] lg:min-w-56">
            <p className="text-xs font-black tracking-[0.16em] text-[#a9282f] uppercase">
              {address ? "Wallet connected" : "Wallet required"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[#4e5968]">
              {address ? "Showing your offers, fills, and direct requests." : "Connect to see your deal activity."}
            </p>
            {!address && <div className="mt-4"><ConnectButton /></div>}
          </div>
        </div>
        <div className="grid border-t border-black/10 sm:grid-cols-3">
          <HistoryStat label="Active deals" value={counts.active} tone="text-[#a9282f]" />
          <HistoryStat label="Completed swaps" value={counts.completed} tone="text-[#a9282f]" />
          <HistoryStat label="Expired offers" value={counts.expired} tone="text-[#a9282f]" />
        </div>
      </section>

      <PageHeader title="Recent activity">
        <div className="flex flex-wrap items-center gap-2">
          <VersionSwitch value={version} onChange={setVersion} />
          <CreateDealButton />
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Filter deals"
          value={filter}
          options={FILTERS.map(([key, label]) => ({ value: key, label }))}
          onChange={setFilter}
        />
        <p className="text-sm text-muted">
          Showing <span className="font-semibold text-[#111318]">{visibleDeals.length}</span> deal
          {visibleDeals.length === 1 ? "" : "s"}
        </p>
      </div>

      {error ? (
        <LoadError title="Couldn&apos;t load history" error={error} />
      ) : isLoading ? (
        <EmptyState>Loading activity…</EmptyState>
      ) : !address ? (
        <EmptyState>
          Connect your wallet to view your deal activity. <ConnectButton />
        </EmptyState>
      ) : visibleDeals.length === 0 ? (
        <EmptyState>
          <p>No {filter === "all" ? "" : `${filter} `}deals yet.</p>
          <CreateDealButton className="mt-5" />
        </EmptyState>
      ) : (
        isV2 ? (
          <ListingGrid listings={visibleDeals as DealV2[]} now={now} me={address} info={info} />
        ) : (
          <DealGrid deals={visibleDeals as Deal[]} now={now} />
        )
      )}
    </div>
  );
}

function isWalletDeal(deal: Pick<Deal, "id" | "maker" | "taker">, address: string | undefined, localFillIds: readonly bigint[]) {
  return !!address
    && (sameAddress(deal.maker, address)
      || sameAddress(deal.taker, address)
      || localFillIds.some((id) => id === deal.id));
}

function filterStatus(filter: Exclude<HistoryFilter, "all">): DisplayStatus {
  if (filter === "active") return "open";
  if (filter === "completed") return "filled";
  return "expired";
}

function HistoryStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col gap-1 border-black/10 px-6 py-4 sm:border-r sm:px-8">
      <strong className={`text-2xl font-black ${tone}`}>{value}</strong>
      <span className="text-xs text-[#4e5968]">{label}</span>
    </div>
  );
}
