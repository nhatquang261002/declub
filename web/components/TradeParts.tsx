"use client";

import Link from "next/link";
import { formatMon, expiryLabel, shortAddress } from "@/lib/format";
import { displayStatus, sameAddress, type DisplayStatus, type Trade } from "@/lib/trades";
import { ChogThumb } from "./Chog";

const BADGE: Record<DisplayStatus, string> = {
  open: "bg-mint/15 text-mint",
  expired: "bg-warn/15 text-warn",
  filled: "bg-accent/20 text-accent",
  cancelled: "bg-zinc-500/20 text-zinc-300",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ${BADGE[status]}`}
    >
      {status}
    </span>
  );
}

export function MonPill({ wei }: { wei: bigint }) {
  return (
    <span className="inline-flex h-14 items-center rounded-lg border border-accent/40 bg-accent/10 px-3 font-semibold whitespace-nowrap text-accent">
      + {formatMon(wei)}
    </span>
  );
}

/** One side of a trade: Chog thumbnails plus a MON pill. */
export function TradeSide({ ids, mon }: { ids: readonly bigint[]; mon: bigint }) {
  if (ids.length === 0 && mon === 0n) return <span className="text-sm text-muted">Nothing</span>;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {ids.map((id) => (
        <ChogThumb key={id.toString()} id={id} />
      ))}
      {mon > 0n && <MonPill wei={mon} />}
    </div>
  );
}

export function TradeCard({ trade, now, me }: { trade: Trade; now: number; me?: string }) {
  const status = displayStatus(trade, now);
  const forMe = sameAddress(trade.taker, me);
  const mine = sameAddress(trade.maker, me);

  return (
    <Link
      href={`/trade/${trade.id}`}
      className="card block p-4 transition hover:border-accent/70 hover:bg-panel-2/40"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Trade #{trade.id.toString()}</span>
        <StatusBadge status={status} />
        {forMe && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold">For you</span>
        )}
        {trade.taker && !forMe && (
          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
            Private
          </span>
        )}
        <span className="ml-auto text-xs text-muted">
          {status === "open" || status === "expired" ? expiryLabel(trade.expiry, now) : ""}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div>
          <div className="label">Gives</div>
          <TradeSide ids={trade.offeredIds} mon={trade.offeredMon} />
        </div>
        <div className="pt-8 text-xl text-muted">⇄</div>
        <div>
          <div className="label">Wants</div>
          <TradeSide ids={trade.requestedIds} mon={trade.requestedMon} />
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

export function TradeGrid({ trades, now, me }: { trades: Trade[]; now: number; me?: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {trades.map((t) => (
        <TradeCard key={t.id.toString()} trade={t} now={now} me={me} />
      ))}
    </div>
  );
}
