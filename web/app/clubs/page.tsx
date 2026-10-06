"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Alert } from "@/components/Alert";
import { ClubAvatar } from "@/components/ClubArt";
import { ClubCard } from "@/components/ClubCard";
import { FlameIcon, GridIcon, ListIcon, SearchIcon, SwapIcon, TrendUpIcon } from "@/components/Icons";
import { HeatMeter } from "@/components/MomentumBadge";
import { Pills } from "@/components/Pills";
import { Select } from "@/components/Select";
import { useClubs } from "@/hooks/useClubs";
import { useMyClubs } from "@/hooks/useClubMembership";
import { useNow } from "@/hooks/useNow";
import { infoAssets, toClubInfo } from "@/lib/clubs";
import { registry } from "@/lib/verifiedAssets";
import { CardSkeleton, ClubListHeader, ClubRow, Leaderboard, type Row } from "./parts";

/** Every Club is a collection's (ADR 0025); some have a memecoin with it. */
type Kind = "all" | "coin";
type Sort = "momentum" | "rising" | "swaps" | "members" | "recent" | "name";
type View = "list" | "grid";

const KINDS = [
  { value: "all", label: "All" },
  { value: "coin", label: "With a memecoin" },
] as const;

const SORTS: { value: Sort; label: string }[] = [
  { value: "momentum", label: "Busiest" },
  { value: "rising", label: "Rising this week" },
  { value: "swaps", label: "Most traded · 7 days" },
  { value: "members", label: "Most members" },
  { value: "recent", label: "Recently active" },
  { value: "name", label: "Name A–Z" },
];

const ORDER: Record<Sort, (a: Row, b: Row) => number> = {
  momentum: (a, b) => (b.stats?.momentum ?? 0) - (a.stats?.momentum ?? 0),
  rising: (a, b) => (b.stats?.change ?? 0) - (a.stats?.change ?? 0),
  swaps: (a, b) => (b.stats?.completed7d ?? 0) - (a.stats?.completed7d ?? 0),
  members: (a, b) => (b.members ?? 0) - (a.members ?? 0),
  recent: (a, b) => (b.stats?.lastActive ?? 0) - (a.stats?.lastActive ?? 0),
  name: (a, b) => a.info.name.localeCompare(b.info.name),
};

/** A Club counts as active once its Momentum would read "Stirring" or more. */
const ACTIVE = 0.5;
const FEATURED = 3;
const BOARD = 5;
const PAGE = 12;
const VIEW_KEY = "declub:clubs-view";

// List or cards is a per-browser preference. Where storage is missing or blocked, the choice
// lasts until the page is closed.
const viewListeners = new Set<() => void>();
let chosenView: View | null = null;
const onViewChange = (listener: () => void) => (viewListeners.add(listener), () => void viewListeners.delete(listener));
function readView(): View {
  if (chosenView) return chosenView;
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}
function chooseView(next: View) {
  chosenView = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {}
  viewListeners.forEach((listener) => listener());
}

/**
 * Every Club (ADR 0016). The most active ones up top, then the whole directory to search, filter
 * and sort. What Clubs are and how Momentum works is on the home page; this page is for using
 * them. The Clubs are the verified list, so the directory draws at once; the numbers fill in from
 * the server and are left out, with a note, if it can't be reached.
 */
export default function ClubsPage() {
  const now = useNow(30_000);
  const { clubs, logging, error } = useClubs();
  const mine = useMyClubs();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("momentum");
  const view = useSyncExternalStore(onViewChange, readView, () => "list" as const);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo<Row[]>(() => {
    const summaries = new Map(clubs?.map((c) => [c.token, c]));
    return registry.clubs().map((entry) => {
      const info = toClubInfo(entry);
      const summary = summaries.get(info.token);
      return { info, stats: summary?.stats, members: summary?.members };
    });
  }, [clubs]);

  const live = rows.filter((r) => !r.info.archived);
  const top = (order: Sort, keep: (r: Row) => boolean, n: number) => live.filter(keep).sort(ORDER[order]).slice(0, n);
  const featured = top("momentum", (r) => (r.stats?.momentum ?? 0) >= ACTIVE, FEATURED);
  const rising = top("rising", (r) => (r.stats?.change ?? 0) >= 1, BOARD);
  const traded = top("swaps", (r) => (r.stats?.completed7d ?? 0) > 0, BOARD);
  const rank = new Map([...live].sort(ORDER.momentum).map((r, i) => [r.info.token, i + 1]));

  const mineSet = useMemo(() => new Set(mine), [mine]);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    // A paired Club is both a collection and a memecoin, and either asset's name finds it.
    const kept = rows.filter(({ info }) => {
      const assets = infoAssets(info);
      return (
        (kind === "all" || info.linked !== undefined) &&
        (!q || assets.some((a) => a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q) || a.token.startsWith(q)))
      );
    });
    // Archived Clubs go last whatever the order: they are kept to be read, not traded.
    return kept.sort((a, b) => Number(a.info.archived) - Number(b.info.archived) || ORDER[sort](a, b) || ORDER.name(a, b));
  }, [rows, query, kind, sort]);
  const shown = found.slice(0, limit);

  const totals = clubs && {
    members: clubs.reduce((n, c) => n + c.members, 0),
    swaps: clubs.reduce((n, c) => n + c.stats.completed7d, 0),
    active: clubs.filter((c) => c.stats.momentum >= ACTIVE).length,
  };
  const myRows = rows.filter((r) => mineSet.has(r.info.token));
  const loading = !clubs && !error;

  // A new search, filter or order starts the list from the top again.
  const search = (q: string) => (setQuery(q), setLimit(PAGE));
  const filter = (k: Kind) => (setKind(k), setLimit(PAGE));
  const order = (s: Sort) => (setSort(s), setLimit(PAGE));

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Clubs</h1>
          <p className="mt-1 text-sm text-muted">
            One for each verified NFT collection, with its memecoin if it has one. Members trade, post and share in its fees.{" "}
            <Link href="/#clubs" className="font-bold underline">
              How Clubs work
            </Link>
          </p>
        </div>
        <dl className="flex flex-wrap gap-2">
          {[
            { label: "Clubs", value: rows.length },
            { label: "active", value: totals?.active },
            { label: "members", value: totals?.members },
            { label: "swaps this week", value: totals?.swaps },
          ].map((s) => (
            <div key={s.label} className="chip flex-row-reverse gap-1.5 bg-white px-3 py-1.5 text-xs">
              <dt className="font-semibold text-muted">{s.label}</dt>
              <dd className="font-black tabular-nums">{s.value?.toLocaleString() ?? "…"}</dd>
            </div>
          ))}
        </dl>
      </header>

      {error && !clubs && (
        <Alert tone="warn" title="Momentum isn’t loading" className="mb-6">
          The Clubs below still work; their numbers will come back on their own.
        </Alert>
      )}
      {logging === false && (
        <Alert tone="info" title="Signed swaps only" className="mb-6">
          This server isn’t keeping an activity log, so Momentum counts signed swaps only.
        </Alert>
      )}

      {myRows.length > 0 && (
        <section className="mb-10" aria-labelledby="your-clubs">
          <h2 id="your-clubs" className="mb-3 text-lg font-black tracking-tight">
            Your Clubs
          </h2>
          <ul className="flex gap-3 overflow-x-auto pt-1 pb-3 [scrollbar-width:thin]">
            {myRows.map(({ info, stats }) => (
              <li key={info.token} className="shrink-0">
                <Link href={`/clubs/${info.token}`} className="club-card flex-row items-center gap-3 py-2.5 pr-4 pl-2.5">
                  <ClubAvatar club={info} className="size-10 text-sm" sizes="40px" />
                  <span className="flex flex-col">
                    <span className="text-sm font-extrabold">{info.name}</span>
                    {stats ? <HeatMeter value={stats.momentum} /> : <span className="text-xs text-muted">{info.symbol}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-12" aria-labelledby="most-active">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="most-active" className="flex items-center gap-2 text-xl font-black tracking-tight">
            <FlameIcon className="size-5 text-[#d83b45]" />
            Most active right now
          </h2>
          <p className="hidden text-xs text-muted sm:block">By Momentum, over the last 30 days</p>
        </div>
        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: FEATURED }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : featured.length === 0 ? (
          <div className="club-panel px-6 py-8 text-center">
            <p className="font-extrabold">It’s quiet everywhere</p>
            <p className="mt-1 text-sm text-muted">No Club has traded in the last 30 days. The first swap puts a Club on top.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((r) => (
              <ClubCard
                key={r.info.token}
                club={r.info}
                stats={r.stats}
                members={r.members}
                now={now}
                rank={rank.get(r.info.token)}
                joined={mineSet.has(r.info.token)}
              />
            ))}
          </div>
        )}

        {clubs && (
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Leaderboard
              title="Rising this week"
              icon={<TrendUpIcon />}
              rows={rising}
              value={(r) => <span className="text-mint">▲ {Math.round(r.stats!.change).toLocaleString()}</span>}
              empty="No Club gained Momentum this week."
            />
            <Leaderboard
              title="Most traded · 7 days"
              icon={<SwapIcon />}
              rows={traded}
              value={(r) => `${r.stats!.completed7d.toLocaleString()} ${r.stats!.completed7d === 1 ? "swap" : "swaps"}`}
              empty="No completed swaps in any Club this week."
            />
          </div>
        )}
      </section>

      <section aria-labelledby="all-clubs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="all-clubs" className="text-xl font-black tracking-tight">
            All Clubs
          </h2>
          <div className="flex items-center gap-1 rounded-xl border-2 border-[#111318] bg-white p-0.5" role="group" aria-label="Layout">
            {(
              [
                { value: "list", label: "List", icon: <ListIcon className="size-4" /> },
                { value: "grid", label: "Cards", icon: <GridIcon className="size-4" /> },
              ] as const
            ).map((v) => (
              <button
                key={v.value}
                type="button"
                aria-pressed={view === v.value}
                aria-label={v.label}
                title={v.label}
                className={`grid size-8 place-items-center rounded-lg ${view === v.value ? "bg-[#111318] text-[#fff4cf]" : "text-muted hover:bg-[#fff4cf]"}`}
                onClick={() => chooseView(v.value)}
              >
                {v.icon}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Search Clubs</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              className="input border-2 border-[#111318] bg-white pl-9 shadow-[0.2rem_0.2rem_0_#111318] focus:border-[#111318]"
              value={query}
              placeholder="Name, symbol or address"
              onChange={(e) => search(e.target.value)}
            />
          </label>
          <Pills value={kind} options={KINDS} onChange={filter} label="Kind of Club" />
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-xs font-bold text-muted">Sort</span>
            <Select value={sort} options={SORTS} onChange={order} aria-label="Sort Clubs" className="w-52" />
          </div>
        </div>

        <p className="mb-3 text-xs text-muted" aria-live="polite">
          {found.length === rows.length
            ? `${rows.length.toLocaleString()} Clubs`
            : `${found.length.toLocaleString()} of ${rows.length.toLocaleString()} Clubs`}
        </p>

        {found.length === 0 ? (
          <div className="club-panel px-6 py-12 text-center">
            <p className="font-extrabold">No Club matches</p>
            <p className="mt-1 text-sm text-muted">Try another name or symbol, or show every kind.</p>
            <button type="button" className="btn-secondary btn-sm mt-4" onClick={() => (search(""), filter("all"))}>
              Clear search
            </button>
          </div>
        ) : view === "list" ? (
          <>
            <ClubListHeader />
            <ol className="club-panel divide-y divide-[#111318]/10 overflow-hidden">
              {shown.map((r, i) => (
                <ClubRow key={r.info.token} row={r} place={sort === "name" ? undefined : i + 1} now={now} joined={mineSet.has(r.info.token)} />
              ))}
            </ol>
          </>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((r) => (
              <ClubCard
                key={r.info.token}
                club={r.info}
                stats={r.stats}
                members={r.members}
                now={now}
                rank={rank.get(r.info.token)}
                joined={mineSet.has(r.info.token)}
              />
            ))}
          </div>
        )}

        {found.length > shown.length && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, found.length - shown.length)} more
            </button>
            <p className="text-xs text-muted">
              Showing {shown.length} of {found.length}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
