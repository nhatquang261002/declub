"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { AssetSide, DealCardV2 } from "@/components/DealCardV2";
import { ExpiryCountdown, SettlementTag, SwapCardShell } from "@/components/DealParts";
import { Masonry } from "@/components/Masonry";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { erc20Tokens, type TokenInfo } from "@/lib/assets";
import { explorerTx } from "@/lib/config";
import { sameAddress } from "@/lib/deals";
import type { DealV2 } from "@/lib/dealsV2";
import { SETTLEMENT_GUIDE } from "@/lib/settlementTerms";
import { Who } from "@/components/Who";
import type { StampStatus } from "@/components/DealSheet";
import { isLive, isSignedListing, reasonText, ringLegs, STATUS_LABEL, type IntentStatus, type PoolIntent, type Settlement } from "@/lib/intents";

type Info = ReadonlyMap<string, TokenInfo>;

const BADGE: Record<IntentStatus, string> = {
  open: "chip-mint",
  stale: "chip-warn",
  settled: "chip-blue",
  cancelled: "",
  expired: "chip-warn",
  consumed: "",
  rejected: "chip-danger",
};

/** The deal page's stamp for an intent status (components/DealSheet.tsx). */
export const INTENT_STAMP: Record<IntentStatus, StampStatus> = {
  open: "open",
  stale: "expired",
  settled: "filled",
  cancelled: "cancelled",
  expired: "expired",
  consumed: "cancelled",
  rejected: "rejected",
};

function IntentStatusBadge({ status }: { status: IntentStatus }) {
  return (
    <span className={`chip uppercase tracking-wide ${BADGE[status]}`}>
      {status === "open" && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Symbols and decimals for every token in a set of intents or settlements. */
export function useIntentsTokenInfo(rows: readonly PoolIntent[]) {
  const tokens = useMemo(
    () => [...new Set([...erc20Tokens(rows.flatMap((r) => [...r.intent.give, ...r.intent.want])), ...rows.map((r) => r.intent.feeToken)])],
    [rows],
  );
  return useTokenInfo(tokens);
}

/** An intent that is still live but past its deadline can't settle, whatever the pool last said. */
const effectiveStatus = (row: PoolIntent, now: number): IntentStatus => (isLive(row.status) && row.intent.deadline < BigInt(now) ? "expired" : row.status);

function IntentCard({ row, now, me, info }: { row: PoolIntent; now: number; me?: string; info: Info }) {
  const status = effectiveStatus(row, now);
  const mine = sameAddress(row.intent.maker, me);
  const timer = isLive(status) ? "open" : status === "expired" ? "expired" : "filled";
  const why = mine && status === "stale" ? reasonText(row.reason) : null;

  return (
    <SwapCardShell
      href={`/intent/${row.hash}`}
      head={
        <>
          <span className="font-black tracking-tight">
            Swap <span className="font-mono text-accent">{row.hash.slice(0, 8)}…</span>
          </span>
          <IntentStatusBadge status={status} />
          <SettlementTag signed />
        </>
      }
      countdown={<ExpiryCountdown expiry={row.intent.deadline} now={now} status={timer} />}
      gives={<AssetSide assets={row.intent.give} info={info} />}
      wants={<AssetSide assets={row.intent.want} info={info} />}
      foot={
        <>
          by <Who address={row.intent.maker} mine={mine} plain />
          {why && <span className="text-warn"> · {why}</span>}
        </>
      }
    />
  );
}

/**
 * Who signs what, said plainly. Shown wherever a maker is about to sign an intent: signing is a
 * standing consent, not a request to a specific person (ADR 0008, 0009).
 */
export function ConsentNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-2 rounded-xl border-2 border-[#b27500] bg-[#fff3d1] p-4 text-sm text-[#4a3200] ${className}`.trim()}>
      <p className="font-black text-[#6b4600]">Signing lets anyone settle this, with anyone</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Any counterparty that meets what you want can settle it. In a ring you may never have heard of the other wallets.</li>
        <li>
          Nothing is locked. Your assets stay in your wallet until the swap, and the approval you give stays in place until it settles, expires, or you revoke
          it.
        </li>
        <li>
          If it settles, the protocol fee comes out of the wallet that signed it, in WMON, for each NFT it gave. If it doesn&apos;t, nobody pays anything.
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
  return sameAddress(address, me) ? <span className="font-black">you</span> : <Who address={address} />;
}

/**
 * A settled cycle: each maker's whole `give` went to the next maker. A pair is a plain swap; three
 * or four is a ring, where nobody had to want what the person they paid was giving.
 */
export function CycleView({ settlement, me, info, footer }: { settlement: Settlement; me?: string; info: Info; footer?: ReactNode }) {
  const legs = ringLegs(settlement.cycle);
  const ring = legs.length > 2;
  return (
    <section className="deal-panel space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip chip-blue uppercase tracking-wide">{ring ? `Ring of ${legs.length}` : "Swap"}</span>
        <h3 className="font-black">{ring ? `Matched across ${legs.length} wallets` : "Matched and swapped"}</h3>
        {settlement.at > 0 && <span className="ml-auto text-xs text-muted">{new Date(settlement.at * 1000).toLocaleString()}</span>}
      </div>

      <ol className="space-y-3">
        {legs.map(({ row, to }) => (
          <li key={row.hash} className="space-y-2 rounded-xl border-2 border-[#111318] bg-white p-3">
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
        <a href={explorerTx(settlement.txHash)} target="_blank" rel="noreferrer" className="font-semibold underline">
          View settlement ↗
        </a>
        {footer}
      </div>
    </section>
  );
}

/**
 * Deals and signed swaps in one grid, each tagged with how it settles. A signed swap links to
 * its own page (it has no deal id); everything else is an ordinary deal card.
 */
export function ListingGrid({ listings, now, me, info }: { listings: readonly DealV2[]; now: number; me?: string; info: Info }) {
  // Two columns, filled without gaps: a card is as tall as its longer side (assets stack), so a
  // plain grid leaves holes beside the cards with a bundle.
  return (
    <Masonry
      items={listings}
      maxColumns={2}
      gap="gap-3"
      height={(listing) =>
        150 +
        56 *
          (isSignedListing(listing)
            ? Math.max(listing.signed.intent.give.length, listing.signed.intent.want.length)
            : Math.max(listing.offered.length, listing.requested.length, 1))
      }
      render={(listing) =>
        isSignedListing(listing) ? (
          <IntentCard key={listing.signed.hash} row={listing.signed} now={now} me={me} info={info} />
        ) : (
          <DealCardV2 key={listing.id.toString()} deal={listing} now={now} me={me} info={info} tag={<SettlementTag signed={false} />} />
        )
      }
    />
  );
}
