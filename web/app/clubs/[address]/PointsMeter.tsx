import { DEFAULT_CLUB_RULES, bonusBps, percent, type ClubRules } from "@/lib/rewards";

/** Points as the app writes them everywhere: "12 pts", or "2.5 pts" when swaps or reach left a fraction. */
export const pts = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} pts`;

type Parts = { points: number; rules?: ClubRules; /** False for a member without NFTs: no bonus to show. */ holder?: boolean; days: number; xPoints?: number; swapPoints?: number; xShares?: number; backedPoints?: number; backers?: number };

/**
 * A member's activity points for the running epoch: the total against the points that earn the
 * whole bonus, and where each point came from, other people's backing first (ADR 0038). The bonus
 * on their shares is what the points turn into, so it is the last line, not the headline.
 */
export function PointsMeter({ points, rules = DEFAULT_CLUB_RULES, holder = true, days, xPoints, swapPoints, xShares, backedPoints, backers }: Parts) {
  const full = rules.fullBonusPoints;
  const dayPoints = days * rules.dayPoints;
  // Copies cached before the breakdown existed give only the total: say so by leaving the rows out.
  const known = xPoints !== undefined && swapPoints !== undefined && backedPoints !== undefined;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-2xl font-black tabular-nums">{pts(points)}</p>
        <p className="text-xs text-muted">{full} pts earn the full bonus</p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-[#111318]/12"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={full}
        aria-valuenow={Math.min(full, points)}
        aria-label="Activity points this epoch"
      >
        <span className="block h-full bg-[#111318]" style={{ width: `${Math.min(100, (points / full) * 100)}%` }} />
      </div>
      {known && (
        <dl className="mt-3 grid gap-1.5 text-sm">
          <Part label="Backed" note={backers ? `by ${backers} ${backers === 1 ? "person" : "people"}` : "likes and replies you receive"} value={backedPoints} />
          <Part
            label="Active days"
            note={
              <span className="flex items-center gap-1" aria-label={`${days} of 7 days`}>
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i} className={`size-2.5 rounded-full border border-[#111318] ${i < days ? "bg-[#111318]" : ""}`} />
                ))}
              </span>
            }
            value={dayPoints}
          />
          <Part label="X shares" note={xShares ? `${xShares} counted` : "none counted"} value={xPoints} />
          <Part label="Swaps" note={`${rules.swapPoints} each, up to ${rules.swapCapPerEpoch}`} value={swapPoints} />
        </dl>
      )}
      {holder ? (
        <p className="mt-2 text-xs text-muted">
          Your NFT shares count {Math.min(100, Math.floor((points / rules.rampPoints) * 100))}% (whole from {rules.rampPoints} pts), +{percent(bonusBps(points, rules))} for these points.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">Members without NFTs share their slice by these points.</p>
      )}
    </div>
  );
}

function Part({ label, note, value }: { label: string; note: React.ReactNode; value: number | undefined }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-24 shrink-0 font-semibold">{label}</dt>
      <dd className="min-w-0 flex-1 text-xs text-muted">{note}</dd>
      <dd className="font-black tabular-nums">{pts(value ?? 0)}</dd>
    </div>
  );
}
