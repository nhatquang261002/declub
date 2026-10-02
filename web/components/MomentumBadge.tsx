import { Tooltip } from "@/components/Tooltip";

/** Momentum is shown whole: a decimal would suggest a precision it doesn't have. */
export const formatMomentum = (value: number) => Math.round(value).toLocaleString();

/**
 * A Club's activity score and how it moved over the week. "Momentum" is explained in place, because
 * what it counts (completed swaps, recent activity) is what stops it being a vanity number.
 */
export function MomentumBadge({ value, change, explain = false }: { value: number; change: number; explain?: boolean }) {
  const moved = Math.round(change);
  const badge = (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-2xl leading-none font-extrabold tabular-nums">{formatMomentum(value)}</span>
      {moved !== 0 && (
        <span className={`text-xs font-bold tabular-nums ${moved > 0 ? "text-mint" : "text-danger"}`}>
          {moved > 0 ? "▲" : "▼"} {Math.abs(moved).toLocaleString()}
          <span className="sr-only"> since last week</span>
        </span>
      )}
    </span>
  );
  if (!explain) return badge;
  return (
    <Tooltip
      content="Momentum shows how busy this market has been. Completed swaps count most, new deals count a little, and anything older than a week counts for less. It doesn't say the asset is safe or valuable."
      className="cursor-help"
    >
      {badge}
    </Tooltip>
  );
}
