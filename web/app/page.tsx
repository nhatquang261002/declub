"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { TradeGrid } from "@/components/TradeParts";
import { ChogSwapArt } from "@/components/ChogArt";
import { useNow } from "@/hooks/useNow";
import { useTrades } from "@/hooks/useTrades";
import { errorMessage } from "@/lib/errors";
import { isExpired, sameAddress, type Trade } from "@/lib/trades";

type Tab = "open" | "for-you" | "all";

const PAGE = 4;

export default function OpenTradesPage() {
  const { address } = useConnection();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("open");
  const [page, setPage] = useState(1);
  const limit = page * PAGE;
  const { trades, total, hasMore, isLoading, error } = useTrades({ limit });

  const isLive = (t: Trade) => t.status === "open" && !isExpired(t, now);
  // Public offers plus private ones addressed to me.
  const visibleToMe = (t: Trade) => !t.taker || sameAddress(t.taker, address);

  const lists: Record<Tab, Trade[]> = {
    open: trades.filter((t) => isLive(t) && visibleToMe(t)),
    "for-you": trades.filter((t) => isLive(t) && !!address && sameAddress(t.taker, address)),
    all: trades,
  };
  const currentList = lists[tab];
  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE));
  const shown = currentList.slice((page - 1) * PAGE, page * PAGE);

  return (
    <>
      <section className="hero-panel mb-12 overflow-hidden">
        <div className="relative grid items-center gap-8 px-6 py-8 sm:px-10 sm:py-12 lg:grid-cols-[1.15fr_0.85fr] lg:px-14">
          <div className="relative z-10 max-w-2xl">
            <div className="eyebrow">
              <Image
                src="/brand/Badge_(Face_Chog)/FACE_CHOG.svg"
                alt=""
                width={18}
                height={18}
                className="size-[18px] rounded-full"
              />
              Chog World Order · Monad testnet
            </div>
            <h1 className="mt-5 text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
              Find your next
              <span className="block text-accent">perfect Chog.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
              Swap Chogs peer-to-peer. Lock your offer, find the one you want, and let the
              contract settle both sides together. No middlemen. Just a little chaos.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/create" className="btn-primary">
                Create a trade <span aria-hidden>↗</span>
              </Link>
            </div>
          </div>
          <ChogSwapArt />
        </div>
        <div className="grid border-t border-white/10 bg-black/10 sm:grid-cols-3">
          <div className="hero-stat"><strong>Non-custodial</strong><span>Your Chogs stay yours until a swap</span></div>
          <div className="hero-stat"><strong>Permissionless</strong><span>Public or direct offers, your choice</span></div>
          <div className="hero-stat"><strong>No platform fees</strong><span>Only the network transaction cost</span></div>
        </div>
      </section>

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

      {error ? (
        <EmptyState>
          <span className="text-danger">Couldn&apos;t load trades: {errorMessage(error)}</span>
        </EmptyState>
      ) : isLoading ? (
        <EmptyState>Loading trades…</EmptyState>
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

      <section className="page-section mt-14 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="font-semibold">New to On Deal?</p>
          <p className="mt-1 text-sm text-muted">Learn how escrow, approvals, expiry, and atomic settlement work.</p>
        </div>
        <Link href="/guide" className="btn-secondary shrink-0">Read the field guide</Link>
      </section>
    </>
  );
}
