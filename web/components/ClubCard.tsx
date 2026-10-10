import Link from "next/link";
import type { ClubInfo, ClubStats } from "@/lib/clubs";
import { ago } from "@/lib/format";
import { ClubAvatar, ClubCover } from "./ClubArt";
import { ArchiveIcon, BadgeCheckIcon, CheckIcon } from "./Icons";
import { formatMomentum, HeatMeter, MomentumChange } from "./MomentumBadge";

export const KIND_LABEL = { erc721: "NFT collection", erc20: "Memecoin" } as const;

/** What the Club is about in a line: "MCHOG · NFT collection", or both symbols for a paired Club. */
export const clubLabel = (club: ClubInfo) =>
  club.linked ? `${club.symbol} + ${club.linked.symbol} · Collection & memecoin` : `${club.symbol} · ${KIND_LABEL[club.kind]}`;

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="kicker">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1.5 text-lg font-black tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * One Club in the list: its cover and face, how busy it is in words and bars, and the three numbers
 * that say the most (Momentum, members, swaps this week). `rank` is its place by Momentum, shown
 * only once it has some.
 */
export function ClubCard({
  club,
  stats,
  members,
  now,
  rank,
  joined = false,
}: {
  club: ClubInfo;
  stats?: ClubStats;
  members?: number;
  now: number;
  rank?: number;
  joined?: boolean;
}) {
  const ranked = rank !== undefined && (stats?.momentum ?? 0) >= 0.5;
  return (
    <Link href={`/clubs/${club.token}`} className="club-card group">
      <ClubCover club={club} className="h-24" markClassName="text-[4.5rem] opacity-[0.1]">
        <div className="relative z-10 flex items-start justify-between gap-2 p-3">
          {ranked ? <span className="chip chip-dark">#{rank}</span> : <span />}
          <span className="flex gap-1.5">
            {joined && (
              <span className="chip chip-peach">
                <CheckIcon />
                Joined
              </span>
            )}
            {club.archived && (
              <span className="chip">
                <ArchiveIcon />
                Archived
              </span>
            )}
          </span>
        </div>
      </ClubCover>

      <div className="flex flex-1 flex-col px-5 pb-5">
        <div className="-mt-9 flex items-end justify-between gap-3">
          <ClubAvatar club={club} className="relative z-10 size-[4.25rem] text-xl" sizes="68px" />
          {stats && <HeatMeter value={stats.momentum} />}
        </div>

        <h2 className="mt-3 flex items-center gap-1.5 text-lg leading-tight font-black tracking-tight">
          <span className="truncate group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">{club.name}</span>
          <BadgeCheckIcon className="size-[1.1rem] shrink-0 text-[#315ea8]" />
          <span className="sr-only">(verified)</span>
        </h2>
        <p className="text-xs font-semibold text-muted">{clubLabel(club)}</p>

        {stats ? (
          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[#111318]/12 pt-3">
            <Figure label="Momentum">
              {formatMomentum(stats.momentum)}
              <MomentumChange change={stats.change} momentum={stats.momentum} />
            </Figure>
            <Figure label="Members">{members !== undefined ? members.toLocaleString() : "—"}</Figure>
            <Figure label="Swaps · 7d">{stats.completed7d.toLocaleString()}</Figure>
          </dl>
        ) : (
          <p className="mt-4 border-t border-[#111318]/12 pt-3 text-xs text-muted">Momentum isn’t available right now.</p>
        )}

        <p className="mt-auto pt-3 text-xs text-muted">
          {stats?.lastActive != null ? `Last activity ${ago(stats.lastActive, now)}` : stats ? "No trades yet. Be the first." : " "}
        </p>
      </div>
    </Link>
  );
}
