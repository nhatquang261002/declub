import type { ReactNode } from "react";
import type { PendingFee } from "@/hooks/useProtocolFee";
import { formatDate, formatFee, type FeeUnit } from "@/lib/format";

/**
 * The protocol fee, said where the person is about to pay it (ADR 0015): the amount, who it
 * comes out of, and that nobody pays for a deal that doesn't complete. Renders nothing when the
 * deployment charges no fee and none is coming.
 *
 * `pending` is a raise the fee admin has queued (ADR 0018), and `pendingNote` says what it means
 * for what the person is about to do. Only pass them for something new (a listing, a signature),
 * never for an existing escrow deal, whose fee is fixed.
 */
export function FeeNote({
  amount,
  unit = "MON",
  pending,
  pendingNote,
  children,
}: {
  amount: bigint;
  unit?: FeeUnit;
  pending?: PendingFee;
  pendingNote?: ReactNode;
  children: ReactNode;
}) {
  const raise = pending && pending.amount > amount ? pending : undefined;
  if (amount === 0n && !raise) return null;
  return (
    <div className="fee-note space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-xs font-extrabold tracking-[0.1em] text-muted uppercase">Protocol fee</span>
        <span className="font-black tabular-nums">{formatFee(amount, unit)}</span>
      </div>
      <p className="text-xs text-muted">{children}</p>
      {raise && (
        <p className="text-xs text-muted">
          Scheduled to rise to <span className="font-semibold">{formatFee(raise.amount, unit)}</span> from{" "}
          {formatDate(raise.at)}. {pendingNote}
        </p>
      )}
    </div>
  );
}
