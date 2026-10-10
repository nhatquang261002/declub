"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { formatMon } from "@/lib/format";
import { displayStatus, sameAddress, type DisplayStatus } from "@/lib/deals";
import type { Deal } from "@/lib/deals";
import { ClockIcon, KeyIcon, LockIcon, SwapIcon, UserIcon } from "./Icons";
import { StatusChip, type StatusLook } from "./StatusChip";
import { Who } from "./Who";

const LOOK: Record<DisplayStatus, StatusLook> = {
  open: "live",
  expired: "timeout",
  filled: "done",
  cancelled: "ended",
};

/** What a status is called wherever people read it. "filled" is the contract's word, not theirs. */
export const STATUS_TEXT: Record<DisplayStatus, string> = {
  open: "Open",
  expired: "Expired",
  filled: "Swapped",
  cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: DisplayStatus }) {
  return <StatusChip look={LOOK[status]} label={STATUS_TEXT[status]} className={status === "open" ? "rotate-[-2deg]" : ""} />;
}

/** Which settlement a card is, where locked deals and signed swaps share one list. */
export function SettlementTag({ signed }: { signed: boolean }) {
  return (
    <span
      className="chip"
      title={
        signed
          ? "Signed, not locked. A matcher settles it when something fits, and it can fail if the assets move."
          : "The maker's side is locked in the contract, so accepting it can't fail."
      }
    >
      {signed ? <SwapIcon /> : <LockIcon />}
      {signed ? "Signed" : "Locked"}
    </span>
  );
}

export function MonPill({ wei }: { wei: bigint }) {
  return (
    <span className="inline-flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-[#836ef9] bg-[#eeeaff] px-1.5 text-center font-semibold leading-tight text-[#111318]">
      <Image src="/brand/mon.svg" alt="" width={22} height={22} className="size-[22px]" />
      <span className="text-[11px]">
        <span className="text-[#836ef9]">+ </span>
        {formatMon(wei)}
      </span>
    </span>
  );
}

export function countdown(expiry: bigint, now: number): string {
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

export function ExpiryCountdown({ expiry, now, status }: { expiry: bigint; now: number; status: DisplayStatus }) {
  if (status !== "open" && status !== "expired") return null;
  if (expiry === 0n) {
    return <span className="chip">∞ No expiry</span>;
  }
  const remaining = Number(expiry) - now;
  const urgent = remaining > 0 && remaining < 3_600;
  return (
    <span
      className={`chip tabular-nums ${status === "expired" ? "chip-warn" : urgent ? "chip-danger" : ""}`}
      title={urgent ? "Less than an hour left" : undefined}
    >
      <ClockIcon />
      {countdown(expiry, now)}
      {remaining > 0 && <span className="font-semibold opacity-70">left</span>}
    </span>
  );
}

/** The gives / wants pair every deal-like card shows: tinted, not outlined, so the card keeps the only border. */
function SwapPanels({ gives, wants }: { gives: ReactNode; wants: ReactNode }) {
  return (
    <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
      <div className="relative flex min-w-0 items-center justify-center rounded-xl bg-[#111318]/[0.05] p-3 pt-5 text-[#111318]">
        <span className="absolute -top-2 left-3 rotate-[-3deg] rounded-sm bg-[var(--chog-cream-500)] px-2 py-0.5 text-[10px] font-black tracking-[0.14em] text-[var(--content-inverse)] uppercase">
          gives
        </span>
        {gives}
      </div>
      <span className="deal-card-seal" aria-hidden>
        <SwapIcon />
      </span>
      <div className="relative flex min-w-0 items-center justify-center rounded-xl bg-[#111318]/[0.05] p-3 pt-5 text-[#111318]">
        <span className="absolute -top-2 right-3 rotate-[3deg] rounded-sm bg-[#d83b45] px-2 py-0.5 text-[10px] font-black tracking-[0.14em] text-white uppercase">
          wants
        </span>
        {wants}
      </div>
    </div>
  );
}

/** The chrome every swap card shares: a link, a header row ending in the countdown, the gives / wants panels and a maker line. */
export function SwapCardShell({
  href,
  head,
  countdown,
  gives,
  wants,
  foot,
}: {
  href: string;
  head: ReactNode;
  countdown: ReactNode;
  gives: ReactNode;
  wants: ReactNode;
  foot: ReactNode;
}) {
  return (
    <Link href={href} className="deal-card group relative block overflow-hidden p-4 transition-colors duration-200">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {head}
        <span className="ml-auto">{countdown}</span>
      </div>
      <SwapPanels gives={gives} wants={wants} />
      <div className="mt-4 text-xs text-muted">{foot}</div>
    </Link>
  );
}

/** A deal's card: its status and expiry, the gives / wants panels, then who made it and its number. */
export function DealCardFrame({
  href,
  deal,
  now,
  me,
  gives,
  wants,
  tag,
}: {
  href: string;
  deal: Pick<Deal, "id" | "maker" | "taker" | "expiry" | "status">;
  now: number;
  me?: string;
  gives: ReactNode;
  wants: ReactNode;
  /** Shown beside the status, e.g. a `SettlementTag` where deal kinds share a list. */
  tag?: ReactNode;
}) {
  const status = displayStatus(deal, now);
  const forMe = sameAddress(deal.taker, me);
  const mine = sameAddress(deal.maker, me);

  return (
    <SwapCardShell
      href={href}
      head={
        <>
          <StatusBadge status={status} />
          {tag}
          {forMe && <span className="chip chip-peach">★ For you</span>}
          {mine && (
            <span className="chip chip-dark">
              <UserIcon />
              Yours
            </span>
          )}
          {deal.taker && !forMe && (
            <span className="chip" title="Made for one wallet: only it can accept">
              <KeyIcon />
              Private
            </span>
          )}
        </>
      }
      countdown={<ExpiryCountdown expiry={deal.expiry} now={now} status={status} />}
      gives={gives}
      wants={wants}
      foot={
        <>
          by <Who address={deal.maker} mine={mine} plain />
          {deal.taker && !forMe && (
            <>
              {" "}
              · only <Who address={deal.taker} plain /> can accept
            </>
          )}
          {/* The number is for quoting a deal, not for picking one, so it trails rather than leads. */}
          <span className="tabular-nums"> · Deal #{deal.id.toString()}</span>
        </>
      }
    />
  );
}
