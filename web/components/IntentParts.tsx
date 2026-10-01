"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { AssetSide, DealCardV2 } from "@/components/DealCardV2";
import { ExpiryCountdown, SettlementTag, SwapPanels } from "@/components/DealParts";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { erc20Tokens, type TokenInfo } from "@/lib/assets";
import { explorerTx } from "@/lib/config";
import { sameAddress } from "@/lib/deals";
import { shortAddress } from "@/lib/format";
import type { DealV2 } from "@/lib/dealsV2";
import { SETTLEMENT_GUIDE } from "@/lib/settlementTerms";
import {
  isLive,
  isSignedListing,
  reasonText,
  ringLegs,
  STATUS_LABEL,
  type IntentStatus,
  type PoolIntent,
  type Settlement,
} from "@/lib/intents";

type Info = ReadonlyMap<string, TokenInfo>;

const BADGE: Record<IntentStatus, string> = {
  open: "bg-mint/15 text-mint",
  stale: "bg-warn/15 text-warn",
  settled: "bg-accent/20 text-accent",
  cancelled: "bg-zinc-500/20 text-zinc-300",
  expired: "bg-zinc-500/20 text-zinc-300",
  consumed: "bg-zinc-500/20 text-zinc-300",
  rejected: "bg-danger/15 text-danger",
};

export function IntentStatusBadge({ status }: { status: IntentStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ${BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Symbols and decimals for every token in a set of intents or settlements. */
export function useIntentsTokenInfo(rows: readonly PoolIntent[]) {
  const tokens = useMemo(() => erc20Tokens(rows.flatMap((r) => [...r.intent.give, ...r.intent.want])), [rows]);
  return useTokenInfo(tokens);
}

/** An intent that is still live but past its deadline can't settle, whatever the pool last said. */
const effectiveStatus = (row: PoolIntent, now: number): IntentStatus =>
  isLive(row.status) && row.intent.deadline < BigInt(now) ? "expired" : row.status;

export function IntentCard({ row, now, me, info }: { row: PoolIntent; now: number; me?: string; info: Info }) {
  const status = effectiveStatus(row, now);
  const mine = sameAddress(row.intent.maker, me);
  const timer = isLive(status) ? "open" : status === "expired" ? "expired" : "filled";
  const why = mine && status === "stale" ? reasonText(row.reason) : null;

  return (
    <Link href={`/intent/${row.hash}`} className="deal-card group relative block overflow-hidden p-4 transition-colors duration-200">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tracking-tight">
          Swap <span className="font-mono">{row.hash.slice(0, 8)}…</span>
        </span>
        <IntentStatusBadge status={status} />
        <SettlementTag signed />
        <span className="ml-auto">
          <ExpiryCountdown expiry={row.intent.deadline} now={now} status={timer} />
        </span>
      </div>
      <SwapPanels
        gives={<AssetSide assets={row.intent.give} info={info} />}
        wants={<AssetSide assets={row.intent.want} info={info} />}
      />
      <div className="mt-4 text-xs text-muted">
        by <span className="font-mono">{mine ? "you" : shortAddress(row.intent.maker)}</span>
        {why && <span className="text-warn"> · {why}</span>}
      </div>
    </Link>
  );
}

export function IntentGrid({ rows, now, me, info }: { rows: readonly PoolIntent[]; now: number; me?: string; info: Info }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((row) => (
        <IntentCard key={row.hash} row={row} now={now} me={me} info={info} />
      ))}
    </div>
  );
}

/**
 * Who signs what, said plainly. Shown wherever a maker is about to sign an intent: signing is a
 * standing consent, not a request to a specific person (ADR 0008, 0009).
 */
export function ConsentNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-2 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm ${className}`.trim()}>
      <p className="font-semibold text-warn">Signing lets anyone settle this, with anyone</p>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>
          Any counterparty that meets what you want can settle it. In a ring you may never have heard of the other
          wallets.
        </li>
        <li>
          Nothing is locked. Your assets stay in your wallet until the swap, and the approval you give stays in place
          until it settles, expires, or you revoke it.
        </li>
        <li>You can&apos;t edit it once signed. Removing it from the pool doesn&apos;t recall a signature that already left, so keep the deadline short.</li>
      </ul>
      <p>
        <Link href={SETTLEMENT_GUIDE} className="font-semibold underline">
          Locked deals vs signed swaps →
        </Link>
      </p>
    </div>
  );
}

function Maker({ address, me }: { address: string; me?: string }) {
  return sameAddress(address, me) ? (
    <span className="font-semibold text-white">you</span>
  ) : (
    <span className="font-mono">{shortAddress(address)}</span>
  );
}

/**
 * A settled cycle: each maker's whole `give` went to the next maker. A pair is a plain swap; three
 * or four is a ring, where nobody had to want what the person they paid was giving.
 */
export function CycleView({ settlement, me, info, footer }: { settlement: Settlement; me?: string; info: Info; footer?: ReactNode }) {
  const legs = ringLegs(settlement.cycle);
  const ring = legs.length > 2;
  return (
    <section className="page-section space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-accent uppercase">
          {ring ? `Ring of ${legs.length}` : "Swap"}
        </span>
        <h3 className="text-sm font-semibold">
          {ring ? `Matched across ${legs.length} wallets` : "Matched and swapped"}
        </h3>
        {settlement.at > 0 && (
          <span className="ml-auto text-xs text-muted">{new Date(settlement.at * 1000).toLocaleString()}</span>
        )}
      </div>

      <ol className="space-y-3">
        {legs.map(({ row, to }) => (
          <li key={row.hash} className="space-y-2 rounded-xl bg-white/5 p-3">
            <p className="text-xs text-muted">
              <Maker address={row.intent.maker} me={me} /> gave to <Maker address={to} me={me} />
            </p>
            <AssetSide assets={row.intent.give} info={info} />
            <Link href={`/intent/${row.hash}`} className="text-xs underline">
              View this intent
            </Link>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <a href={explorerTx(settlement.txHash)} target="_blank" rel="noreferrer" className="underline hover:text-white">
          View settlement ↗
        </a>
        {footer}
      </div>
    </section>
  );
}

/**
 * Deals and signed swaps in one grid, each tagged with how it settles. A signed swap links to
 * its own page (it has no deal id); everything else is an ordinary V2 deal card.
 */
export function ListingGrid({ listings, now, me, info }: { listings: readonly DealV2[]; now: number; me?: string; info: Info }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {listings.map((listing) =>
        isSignedListing(listing) ? (
          <IntentCard key={listing.signed.hash} row={listing.signed} now={now} me={me} info={info} />
        ) : (
          <DealCardV2 key={listing.id.toString()} deal={listing} now={now} me={me} info={info} tag={<SettlementTag signed={false} />} />
        ),
      )}
    </div>
  );
}
