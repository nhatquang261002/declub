"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { EmptyState, PageHeader } from "@/components/Page";
import { TradeGridV2 } from "@/components/TradeCardV2";
import { TradeGrid } from "@/components/TradeParts";
import { VersionSwitch, type TradeVersion } from "@/components/VersionSwitch";
import { useLocalFills } from "@/hooks/useLocalFills";
import { useNow } from "@/hooks/useNow";
import { useTradesTokenInfo } from "@/hooks/useTokenInfo";
import { useTrades } from "@/hooks/useTrades";
import { useTradesV2 } from "@/hooks/useTradesV2";
import { CHOG_SWAP_ADDRESS, CHOG_SWAP_V2_ADDRESS } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { displayStatus, sameAddress, type DisplayStatus, type Trade } from "@/lib/trades";
import type { TradeV2 } from "@/lib/tradesV2";

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
  const [version, setVersion] = useState<TradeVersion>("v1");
  const isV2 = version === "v2";
  const v1 = useTrades({ limit: 200, enabled: !isV2 });
  const v2 = useTradesV2({ limit: 200, enabled: isV2 });
  const { info } = useTradesTokenInfo(v2.trades);
  // Fills are remembered per contract, so each version reads its own record.
  const v1Fills = useLocalFills(address, CHOG_SWAP_ADDRESS);
  const v2Fills = useLocalFills(address, CHOG_SWAP_V2_ADDRESS ?? CHOG_SWAP_ADDRESS);
  const { isLoading, error } = isV2 ? v2 : v1;
  const trades: Array<Trade | TradeV2> = isV2 ? v2.trades : v1.trades;
  const localFillIds = isV2 ? v2Fills.ids : v1Fills.ids;
  const createHref = isV2 ? "/v2/create" : "/create";

  const walletTrades = useMemo(
    () => trades.filter((trade) => isWalletTrade(trade, address, localFillIds)),
    [address, localFillIds, trades],
  );
  const statuses = useMemo(
    () => walletTrades.map((trade) => displayStatus(trade, now)),
    [now, walletTrades],
  );
  const counts = useMemo(
    () => ({
      active: statuses.filter((status) => status === "open").length,
      completed: statuses.filter((status) => status === "filled").length,
      expired: statuses.filter((status) => status === "expired").length,
    }),
    [statuses],
  );
  const visibleTrades = useMemo(
    () =>
      filter === "all"
        ? walletTrades
        : walletTrades.filter((trade) => displayStatus(trade, now) === filterStatus(filter)),
    [filter, now, walletTrades],
  );

  return (
    <div className="space-y-10">
      <section className="hero-panel overflow-hidden">
        <div className="grid gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="eyebrow">Your trade journal</div>
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
              {address ? "Showing your offers, fills, and direct requests." : "Connect to see your trade activity."}
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
          <Link href={createHref} className="btn-primary">
            Create a trade <span aria-hidden>↗</span>
          </Link>
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-line bg-panel p-1 text-sm">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                filter === key ? "bg-panel-2 text-white" : "text-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          Showing <span className="font-semibold text-white">{visibleTrades.length}</span> trade
          {visibleTrades.length === 1 ? "" : "s"}
        </p>
      </div>

      {error ? (
        <EmptyState>
          <span className="text-danger">Couldn&apos;t load history: {errorMessage(error)}</span>
        </EmptyState>
      ) : isLoading ? (
        <EmptyState>Loading activity…</EmptyState>
      ) : !address ? (
        <EmptyState>
          Connect your wallet to view your trade activity. <ConnectButton />
        </EmptyState>
      ) : visibleTrades.length === 0 ? (
        <EmptyState>
          No {filter === "all" ? "" : `${filter} `}trades yet.{" "}
          <Link href={createHref} className="text-accent underline">
            Create one
          </Link>
        </EmptyState>
      ) : (
        isV2 ? (
          <TradeGridV2 trades={visibleTrades as TradeV2[]} now={now} me={address} info={info} />
        ) : (
          <TradeGrid trades={visibleTrades as Trade[]} now={now} />
        )
      )}
    </div>
  );
}

function isWalletTrade(trade: Pick<Trade, "id" | "maker" | "taker">, address: string | undefined, localFillIds: readonly bigint[]) {
  return !!address
    && (sameAddress(trade.maker, address)
      || sameAddress(trade.taker, address)
      || localFillIds.some((id) => id === trade.id));
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
