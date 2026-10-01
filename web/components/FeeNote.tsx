import type { ReactNode } from "react";
import { formatFee, type FeeUnit } from "@/lib/format";

/**
 * The protocol fee, said where the person is about to pay it (ADR 0015): the amount, who it
 * comes out of, and that nobody pays for a deal that doesn't complete. Renders nothing when the
 * deployment charges no fee.
 */
export function FeeNote({ amount, unit = "MON", children }: { amount: bigint; unit?: FeeUnit; children: ReactNode }) {
  if (amount === 0n) return null;
  return (
    <div className="space-y-1 rounded-xl bg-white/5 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-muted">Protocol fee</span>
        <span className="font-semibold">{formatFee(amount, unit)}</span>
      </div>
      <p className="text-xs text-muted">{children}</p>
    </div>
  );
}
