"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { formatMon } from "@/lib/format";
import { displayStatus, sameAddress, type DisplayStatus } from "@/lib/deals";
import type { DealV2 } from "@/lib/dealsV2";
import { ClockIcon, LockIcon, SwapIcon } from "./Icons";
import { Who } from "./Who";

const BADGE: Record<DisplayStatus, string> = {
  open: "chip-mint",
  expired: "chip-warn",
  filled: "chip-blue",
  cancelled: "",
};

/** What a status is called wherever people read it. "filled" is the contract's word, not theirs. */
export const STATUS_TEXT: Record<DisplayStatus, string> = {
  open: "Open",
  expired: "Expired",
  filled: "Swapped",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`chip ${BADGE[status]} uppercase tracking-wide ${status === "open" ? "rotate-[-2deg]" : ""}`}>
      {status === "open" && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {STATUS_TEXT[status]}
    </span>
  );
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
    <span className="inline-flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-[#836ef9] bg-[#eeeaff] px-1.5 text-center font-semibold leading-tight text-[#111318] shadow-[0.18rem_0.18rem_0_#111318]">
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

/** The gives / wants pair every deal-like card shows. */
export function SwapPanels({ gives, wants }: { gives: ReactNode; wants: ReactNode }) {
  return (
    <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
      <div className="relative flex items-center justify-center rounded-xl border border-[#111318] bg-[#fff4cf] p-3 pt-5 text-[#111318]">
        <span className="absolute -top-2 left-3 rotate-[-3deg] rounded-sm bg-[var(--chog-cream-500)] px-2 py-0.5 text-[10px] font-black tracking-[0.14em] text-[var(--content-inverse)] uppercase shadow-sm">
          gives
        </span>
        {gives}
      </div>
      <span className="deal-card-seal" aria-hidden>
        <SwapIcon />
      </span>
      <div className="relative flex items-center justify-center rounded-xl border border-[#111318] bg-[#fff4cf] p-3 pt-5 text-[#111318]">
        <span className="absolute -top-2 right-3 rotate-[3deg] rounded-sm bg-[#d83b45] px-2 py-0.5 text-[10px] font-black tracking-[0.14em] text-white uppercase shadow-sm">
          wants
        </span>
        {wants}
      </div>
    </div>
  );
}

/** The card chrome shared by deals and signed swaps: header row, gives / wants panels, maker line. */
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
  deal: Pick<DealV2, "id" | "maker" | "taker" | "expiry" | "status">;
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
    <Link
      href={href}
      className="deal-card group relative block overflow-hidden p-4 transition-colors duration-200"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-black tracking-tight">
          <span className="text-accent">#</span>
          {deal.id.toString()}
        </span>
        <StatusBadge status={status} />
        {tag}
        {forMe && <span className="chip chip-peach">★ For you</span>}
        {mine && <span className="chip chip-dark">Yours</span>}
        {deal.taker && !forMe && <span className="chip">Private</span>}
        <span className="ml-auto"><ExpiryCountdown expiry={deal.expiry} now={now} status={status} /></span>
      </div>

      <SwapPanels gives={gives} wants={wants} />

      <div className="mt-4 text-xs text-muted">
        by <Who address={deal.maker} mine={mine} plain />
        {deal.taker && !forMe && (
          <>
            {" "}
            · only <Who address={deal.taker} plain /> can accept
          </>
        )}
      </div>
    </Link>
  );
}
