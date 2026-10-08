import { heat } from "@/lib/clubs";
import { MOMENTUM } from "@/lib/momentum";

/** Momentum is shown whole: a decimal would suggest a precision it doesn't have. */
export const formatMomentum = (value: number) => Math.round(value).toLocaleString();

export const MOMENTUM_EXPLAINED = `Momentum shows how busy this Club has been. Completed swaps count most; new deals and Holders' Board posts and own X posts about the Club count a little. Points halve every ${MOMENTUM.halfLifeDays} days and are gone after ${MOMENTUM.windowDays}. It doesn't say the asset is safe or valuable.`;

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
