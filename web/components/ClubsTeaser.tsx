"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ClubAvatar } from "@/components/ClubArt";
import { formatMomentum, HeatMeter } from "@/components/MomentumBadge";
import { useClubs } from "@/hooks/useClubs";
import { toClubInfo } from "@/lib/clubs";
import { registry } from "@/lib/verifiedAssets";

const SHOWN = 3;

/** The busiest Clubs right now, as a taste of /clubs. Before Momentum arrives, the list's own order. */
export function ClubsTeaser() {
  const { clubs } = useClubs();
  const rows = useMemo(() => {
    const live = registry
      .clubs()
      .filter((e) => e.club !== "archived")
      .map(toClubInfo);
    if (!clubs) return live.slice(0, SHOWN).map((info) => ({ info, momentum: undefined }));
    const byToken = new Map(clubs.map((c) => [c.token, c.stats.momentum]));
    // Only Clubs with some activity: "busiest" shouldn't list a quiet one.
    return live
      .map((info) => ({ info, momentum: byToken.get(info.token) }))
      .filter((row) => (row.momentum ?? 0) >= 0.5)
      .sort((a, b) => (b.momentum ?? 0) - (a.momentum ?? 0))
      .slice(0, SHOWN);
  }, [clubs]);

  return (
    <div className="club-panel p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="kicker">Busiest right now</h3>
        <Link href="/clubs" className="text-xs font-bold text-[#a9282f] hover:underline">
          All Clubs →
        </Link>
      </div>
      {rows.length === 0 && <p className="py-6 text-center text-sm text-muted">It’s quiet: no Club has traded this month. The first swap tops the list.</p>}
      <ol className="flex flex-col gap-2">
        {rows.map(({ info, momentum }, i) => (
          <li key={info.token}>
            <Link href={`/clubs/${info.token}`} className="flex items-center gap-3 rounded-xl p-2 text-[#111318] transition-colors hover:bg-white">
              <span className="w-4 text-center text-sm font-black text-muted tabular-nums">{i + 1}</span>
              <ClubAvatar club={info} className="size-10 text-sm" sizes="40px" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-extrabold">{info.name}</span>
                {momentum !== undefined ? <HeatMeter value={momentum} /> : <span className="text-xs text-muted">{info.symbol}</span>}
              </span>
              {momentum !== undefined && <span className="text-lg font-black tabular-nums">{formatMomentum(momentum)}</span>}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
