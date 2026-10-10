import Link from "next/link";
import type { ReactNode } from "react";
import { ClubAvatar } from "@/components/ClubArt";
import { clubLabel } from "@/components/ClubCard";
import { formatMomentum, HeatMeter, MomentumChange } from "@/components/MomentumBadge";
import { ArchiveIcon, BadgeCheckIcon, CheckIcon } from "@/components/Icons";
import type { ClubInfo, ClubStats } from "@/lib/clubs";
import { ago } from "@/lib/format";

export type Row = { info: ClubInfo; stats?: ClubStats; members?: number };

/** Columns of the directory's list view, shared by its header and its rows. */
const COLUMNS = "md:grid md:grid-cols-[2rem_minmax(0,1fr)_6.5rem_6.5rem_5.5rem_5.5rem_6.5rem] md:gap-4";

export function ClubListHeader() {
  return (
    <div className={`hidden px-5 pb-2 ${COLUMNS} kicker`} aria-hidden>
      <span>#</span>
      <span>Club</span>
      <span>Heat</span>
      <span className="text-right">Momentum</span>
      <span className="text-right">Members</span>
      <span className="text-right">Swaps · 7d</span>
      <span className="text-right">Last active</span>
    </div>
  );
}

/** One Club as a row of the directory's list view: everything a scan needs on one line. */
export function ClubRow({ row, place, now, joined }: { row: Row; place?: number; now: number; joined: boolean }) {
  const { info, stats, members } = row;
  return (
    <li>
      <Link
        href={`/clubs/${info.token}`}
        className={`group flex items-center gap-3 px-4 py-3 text-[#111318] transition-colors hover:bg-white sm:px-5 ${COLUMNS} md:items-center`}
      >
        <span className="w-6 shrink-0 text-center text-sm font-black text-muted tabular-nums md:w-auto md:text-left">{place ?? ""}</span>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <ClubAvatar club={info} className="size-10 text-sm" sizes="40px" />
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-extrabold group-hover:underline">{info.name}</span>
              <BadgeCheckIcon className="size-[1.1rem] shrink-0 text-[#315ea8]" />
              <span className="sr-only">(verified)</span>
              {/* The name truncates before the chips do. */}
              {joined && (
                <span className="chip chip-peach shrink-0">
                  <CheckIcon />
                  Joined
                </span>
              )}
              {info.archived && (
                <span className="chip shrink-0 p-0.5" role="img" aria-label="Archived" title="Archived: not taking new members">
                  <ArchiveIcon />
                </span>
              )}
            </span>
            <span className="truncate text-xs text-muted">{clubLabel(info)}</span>
            {stats && (
              <span className="mt-0.5 md:hidden">
                <HeatMeter value={stats.momentum} />
              </span>
            )}
          </span>
        </span>
        <span className="hidden md:block">{stats && <HeatMeter value={stats.momentum} />}</span>
        <span className="flex shrink-0 flex-col items-end md:block md:text-right">
          <span className="font-black tabular-nums">{stats ? formatMomentum(stats.momentum) : "—"}</span>
          {stats && (
            <span className="block text-right">
              <MomentumChange change={stats.change} />
            </span>
          )}
        </span>
        <span className="hidden text-right font-bold tabular-nums md:block">{members?.toLocaleString() ?? "—"}</span>
        <span className="hidden text-right font-bold tabular-nums md:block">{stats?.completed7d.toLocaleString() ?? "—"}</span>
        <span className="hidden text-right text-xs text-muted md:block">{stats?.lastActive != null ? ago(stats.lastActive, now) : stats ? "never" : "—"}</span>
      </Link>
    </li>
  );
}

/**
 * A short ranked list of Clubs by one measure: rising, most traded. `value` says the measure for
 * each Club; an empty list says why rather than vanishing.
 */
export function Leaderboard({
  title,
  icon,
  rows,
  value,
  empty,
}: {
  title: string;
  icon: ReactNode;
  rows: Row[];
  value: (row: Row) => ReactNode;
  empty: string;
}) {
  return (
    <section className="club-panel p-5" aria-label={title}>
      <h3 className="mb-3 flex items-center gap-2 font-black">
        <span className="grid size-7 place-items-center rounded-lg border-2 border-[#111318] bg-[#f0b735] [&_svg]:size-4">{icon}</span>
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted">{empty}</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((row, i) => (
            <li key={row.info.token}>
              <Link
                href={`/clubs/${row.info.token}`}
                className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1.5 text-[#111318] transition-colors hover:bg-white"
              >
                <span className="w-4 text-center text-xs font-black text-muted tabular-nums">{i + 1}</span>
                <ClubAvatar club={row.info} className="size-8 text-xs" sizes="32px" />
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{row.info.name}</span>
                <span className="text-sm font-bold tabular-nums">{value(row)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A card-shaped placeholder while Momentum loads. */
export function CardSkeleton() {
  return (
    <div className="club-card animate-pulse motion-reduce:animate-none" aria-hidden>
      <div className="h-24 bg-[#111318]/10" />
      <div className="flex flex-col gap-3 p-5">
        <div className="-mt-12 size-16 rounded-2xl bg-[#111318]/15" />
        <div className="h-4 w-1/2 rounded bg-[#111318]/10" />
        <div className="h-3 w-1/3 rounded bg-[#111318]/10" />
        <div className="mt-3 h-10 rounded bg-[#111318]/10" />
      </div>
    </div>
  );
}
