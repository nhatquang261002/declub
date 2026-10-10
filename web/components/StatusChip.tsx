import type { ReactNode } from "react";
import { BanIcon, CheckIcon, CrossIcon, HourglassIcon, PauseIcon, SwapIcon } from "./Icons";

/** What a status means to the reader, whatever the contract or pool calls it. */
export type StatusLook = "live" | "done" | "timeout" | "paused" | "ended" | "moved" | "refused";

const LOOK: Record<StatusLook, { tone: string; mark: ReactNode }> = {
  live: { tone: "chip-mint", mark: <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden /> },
  done: { tone: "chip-blue", mark: <CheckIcon /> },
  timeout: { tone: "chip-warn", mark: <HourglassIcon /> },
  paused: { tone: "chip-warn", mark: <PauseIcon /> },
  ended: { tone: "", mark: <CrossIcon /> },
  moved: { tone: "", mark: <SwapIcon /> },
  refused: { tone: "chip-danger", mark: <BanIcon /> },
};

/** A deal, swap or offer status: the colour and mark say it at a glance, the word says it exactly. */
export function StatusChip({ look, label, className = "" }: { look: StatusLook; label: string; className?: string }) {
  const { tone, mark } = LOOK[look];
  return (
    <span className={`chip uppercase tracking-wide ${tone} ${className}`}>
      {mark}
      {label}
    </span>
  );
}
