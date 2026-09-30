"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { formatMon, shortAddress } from "@/lib/format";
import { displayStatus, sameAddress, type DisplayStatus, type Trade } from "@/lib/trades";
import type { TraitFilter } from "@/lib/traitRequests";
import { ChogThumb } from "./Chog";
import { TraitRequestSummary } from "./TraitRequest";

const BADGE: Record<DisplayStatus, string> = {
  open: "bg-mint/15 text-mint",
  expired: "bg-warn/15 text-warn",
  filled: "bg-accent/20 text-accent",
  cancelled: "bg-zinc-500/20 text-zinc-300",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ${BADGE[status]} ${
        status === "open" ? "rotate-[-2deg]" : ""
      }`}
    >
      {status}
    </span>
  );
}

export function MonPill({ wei }: { wei: bigint }) {
  return (
    <span className="inline-flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-[#836ef9] bg-[#eeeaff] px-1.5 text-center font-semibold leading-tight text-[#111318] shadow-[0.18rem_0.18rem_0_#111318]">
      <Image src="/brand/mon.svg" alt="" width={22} height={22} className="size-[22px]" />
      <span className="text-[11px]">
        <span className="text-[#836ef9]">+ </span>
        {formatMon(wei)}
      </span>
    </span>
  );
}

function countdown(expiry: bigint, now: number): string {
  const seconds = Number(expiry) - now;
  if (seconds <= 0) return "Expired";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
}

function ExpiryCountdown({ expiry, now, status }: { expiry: bigint; now: number; status: DisplayStatus }) {
  if (status !== "open" && status !== "expired") return null;
  if (expiry === 0n) {
    return <span className="text-xs text-muted">∞ no expiry</span>;
  }
  const remaining = Number(expiry) - now;
  const urgent = remaining > 0 && remaining < 3_600;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
      status === "expired"
        ? "border-warn/30 text-warn"
        : urgent
          ? "border-line text-white"
          : "border-line text-muted"
    }`}>
      <span aria-hidden>{status === "expired" ? "!" : "◷"}</span>
      {countdown(expiry, now)}
    </span>
  );
}

/** One side of a trade: Chog thumbnails plus a MON pill. */
export function TradeSide({ ids, mon }: { ids: readonly bigint[]; mon: bigint }) {
  if (ids.length === 0 && mon === 0n) return <span className="text-sm text-muted">Nothing</span>;
  return (
    <div className="flex min-h-20 flex-wrap items-start justify-center gap-2">
      {ids.map((id) => (
        <ChogThumb key={id.toString()} id={id} large />
      ))}
      {mon > 0n && <MonPill wei={mon} />}
    </div>
  );
}

/** The card chrome shared by v1 and V2 trades: header row, gives / wants panels, maker line. */
export function TradeCardFrame({
  href,
  trade,
  now,
  me,
  gives,
  wants,
}: {
  href: string;
  trade: Pick<Trade, "id" | "maker" | "taker" | "expiry" | "status">;
  now: number;
  me?: string;
  gives: ReactNode;
  wants: ReactNode;
}) {
  const status = displayStatus(trade, now);
  const forMe = sameAddress(trade.taker, me);
  const mine = sameAddress(trade.maker, me);

  return (
    <Link
      href={href}
      className="trade-card group relative block overflow-hidden p-4 transition-colors duration-200"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tracking-tight">Trade #{trade.id.toString()}</span>
        <StatusBadge status={status} />
        {forMe && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold">For you</span>
        )}
        {trade.taker && !forMe && (
          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
            Private
          </span>
        )}
        <span className="ml-auto"><ExpiryCountdown expiry={trade.expiry} now={now} status={status} /></span>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <div className="relative rounded-xl border border-[#111318] bg-[#fff4cf] p-3 pt-5 text-[#111318]">
          <span className="absolute -top-2 left-3 rotate-[-3deg] rounded-sm bg-[var(--chog-cream-500)] px-2 py-0.5 text-[10px] font-black tracking-[0.14em] text-[var(--content-inverse)] uppercase shadow-sm">
            gives
          </span>
          {gives}
        </div>
        <div className="flex items-center text-lg text-muted">↔</div>
        <div className="relative rounded-xl border border-[#111318] bg-[#fff4cf] p-3 pt-5 text-[#111318]">
          <span className="absolute -top-2 right-3 rotate-[3deg] rounded-sm bg-[#d83b45] px-2 py-0.5 text-[10px] font-black tracking-[0.14em] text-white uppercase shadow-sm">
            wants
          </span>
          {wants}
        </div>
      </div>

      <div className="mt-4 text-xs text-muted">
        by <span className="font-mono">{mine ? "you" : shortAddress(trade.maker)}</span>
        {trade.taker && !forMe && (
          <>
            {" "}
            · only <span className="font-mono">{shortAddress(trade.taker)}</span> can accept
          </>
        )}
      </div>
    </Link>
  );
}

export function TradeCard({
  trade,
  now,
  me,
  traitLabels,
}: {
  trade: Trade;
  now: number;
  me?: string;
  /** Merkle root (lowercase) → trait, so trait requests can be named. */
  traitLabels?: Map<string, TraitFilter>;
}) {
  return (
    <TradeCardFrame
      href={`/trade/${trade.id}`}
      trade={trade}
      now={now}
      me={me}
      gives={<TradeSide ids={trade.offeredIds} mon={trade.offeredMon} />}
      wants={
        trade.requestedRoot && trade.requestedCount && trade.requestedCount > 0n ? (
          <TraitRequestSummary
            filter={traitLabels?.get(trade.requestedRoot.toLowerCase())}
            count={trade.requestedCount}
            root={trade.requestedRoot}
          />
        ) : (
          <TradeSide ids={trade.requestedIds} mon={trade.requestedMon} />
        )
      }
    />
  );
}

export function TradeGrid({
  trades,
  now,
  me,
  traitLabels,
}: {
  trades: Trade[];
  now: number;
  me?: string;
  traitLabels?: Map<string, TraitFilter>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {trades.map((t) => (
        <TradeCard key={t.id.toString()} trade={t} now={now} me={me} traitLabels={traitLabels} />
      ))}
    </div>
  );
}
