import Link from "next/link";
import { initials, type ClubInfo, type ClubStats } from "@/lib/clubs";
import { ago } from "@/lib/format";
import { MomentumBadge } from "./MomentumBadge";

export const KIND_LABEL = { erc721: "NFT collection", erc20: "Token" } as const;

/** A tile with the asset's initials, until collections have art of their own. */
export function ClubTile({ name, className = "size-12 text-sm" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-2xl border border-line bg-panel-2 font-black tracking-tight uppercase ${className}`}
    >
      {initials(name)}
    </span>
  );
}

export function ClubCard({ club, stats, members, now }: { club: ClubInfo; stats?: ClubStats; members?: number; now: number }) {
  return (
    <Link href={`/clubs/${club.token}`} className="page-section flex flex-col gap-4 p-5 transition-transform hover:-translate-y-0.5">
      <div className="flex items-center gap-3">
        <ClubTile name={club.name} />
        <div className="min-w-0">
          <h2 className="truncate text-lg leading-tight font-extrabold">{club.name}</h2>
          <p className="text-xs text-muted">
            {club.symbol} · {KIND_LABEL[club.kind]}
          </p>
        </div>
        {club.archived && <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-xs text-muted">Archived</span>}
      </div>
      {stats ? (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Momentum</p>
            <MomentumBadge value={stats.momentum} change={stats.change} />
          </div>
          <dl className="grid grid-cols-2 gap-x-5 text-right text-xs">
            <dt className="text-muted">Swaps, 7d</dt>
            <dt className="text-muted">Traders, 30d</dt>
            <dd className="text-base font-bold tabular-nums">{stats.completed7d}</dd>
            <dd className="text-base font-bold tabular-nums">{stats.traders30d}</dd>
          </dl>
        </div>
      ) : (
        <p className="text-xs text-muted">Momentum isn’t available right now.</p>
      )}
      {(members !== undefined || stats?.lastActive != null) && (
        <p className="text-xs text-muted">
          {members !== undefined && `${members.toLocaleString()} ${members === 1 ? "member" : "members"}`}
          {members !== undefined && stats?.lastActive != null && " · "}
          {stats?.lastActive != null && `Last activity ${ago(stats.lastActive, now)}`}
        </p>
      )}
    </Link>
  );
}
