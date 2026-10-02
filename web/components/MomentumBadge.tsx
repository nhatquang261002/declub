import { Tooltip } from "@/components/Tooltip";
import { heat } from "@/lib/clubs";

/** Momentum is shown whole: a decimal would suggest a precision it doesn't have. */
export const formatMomentum = (value: number) => Math.round(value).toLocaleString();

export const MOMENTUM_EXPLAINED =
  "Momentum shows how busy this market has been. Completed swaps count most, new deals count a little, and anything older than a week counts for less. It doesn't say the asset is safe or valuable.";

/** Five rising bars, lit up to `level` (0, quiet, lights none). Decoration: say the level in words beside it. */
export function HeatBars({ level }: { level: number }) {
  return (
    <span className={`heat heat-${level}`} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} data-on={i <= level && level > 0 ? "" : undefined} />
      ))}
    </span>
  );
}

/** The bars lit to the Club's heat, with the word for it. */
export function HeatMeter({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const { level, label } = heat(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <HeatBars level={level} />
      {showLabel ? <span className="text-xs font-extrabold">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

/** How Momentum moved over the week: ▲ 12 or ▼ 3, nothing when flat. */
export function MomentumChange({ change }: { change: number }) {
  const moved = Math.round(change);
  if (moved === 0) return null;
  return (
    <span className={`text-xs font-bold tabular-nums ${moved > 0 ? "text-mint" : "text-danger"}`}>
      {moved > 0 ? "▲" : "▼"} {Math.abs(moved).toLocaleString()}
      <span className="sr-only"> since last week</span>
    </span>
  );
}

/**
 * A Club's activity score and how it moved over the week. "Momentum" is explained in place, because
 * what it counts (completed swaps, recent activity) is what stops it being a vanity number.
 */
export function MomentumBadge({ value, change, explain = false }: { value: number; change: number; explain?: boolean }) {
  const badge = (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-2xl leading-none font-extrabold tabular-nums">{formatMomentum(value)}</span>
      <MomentumChange change={change} />
    </span>
  );
  if (!explain) return badge;
  return (
    <Tooltip content={MOMENTUM_EXPLAINED} className="cursor-help">
      {badge}
    </Tooltip>
  );
}
