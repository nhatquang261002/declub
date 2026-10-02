"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ClubCard, ClubTile } from "@/components/ClubCard";
import { EmptyState, PageHeader } from "@/components/Page";
import { useClubs } from "@/hooks/useClubs";
import { useMyClubs } from "@/hooks/useClubMembership";
import { useNow } from "@/hooks/useNow";
import { toClubInfo } from "@/lib/clubs";
import { registry } from "@/lib/verifiedAssets";

/**
 * Every Club (ADR 0016), busiest first. The Clubs are the verified assets on the list, so the
 * cards draw at once; Momentum fills in from the server and is left out if it can't be reached.
 */
export default function ClubsPage() {
  const now = useNow(30_000);
  const { clubs, logging, error } = useClubs();
  const mine = useMyClubs();

  const rows = useMemo(() => {
    const summaries = new Map(clubs?.map((c) => [c.token, c]));
    const listed = registry.clubs().map((entry) => {
      const info = toClubInfo(entry);
      const summary = summaries.get(info.token);
      return { info, stats: summary?.stats, members: summary?.members };
    });
    // The server's order is busiest first. Until it answers, the list's own order stands.
    return clubs ? [...listed].sort((a, b) => (b.stats?.momentum ?? 0) - (a.stats?.momentum ?? 0)) : listed;
  }, [clubs]);

  return (
    <>
      <PageHeader title="Clubs" />
      <p className="mb-6 max-w-2xl text-sm text-muted">
        One place for each verified collection or token: its live deals, who has been trading it, and how busy it is.
        Momentum counts completed swaps most, so it follows real trading rather than noise.
      </p>
      {mine.length > 0 && (
        <section className="mb-6" aria-label="Your Clubs">
          <h2 className="mb-2 text-sm font-bold text-muted">Your Clubs</h2>
          <ul className="flex flex-wrap gap-2">
            {mine.flatMap((token) => {
              const entry = registry.clubFor(token);
              return entry ? [entry] : [];
            }).map((entry) => (
              <li key={entry.address}>
                <Link href={`/clubs/${entry.address.toLowerCase()}`} className="page-section flex items-center gap-2 px-3 py-2 text-sm font-semibold">
                  <ClubTile name={entry.name} className="size-7 rounded-lg text-[10px]" />
                  {entry.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && !clubs && <p className="mb-4 text-sm text-warn">Couldn’t load Momentum. The Clubs below still work.</p>}
      {logging === false && (
        <p className="mb-4 text-sm text-muted">This server isn’t keeping an activity log, so Momentum counts signed swaps only.</p>
      )}
      {rows.length === 0 ? (
        <EmptyState>No Clubs yet. A Club opens for each verified collection or token.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ info, stats, members }) => (
            <ClubCard key={info.token} club={info} stats={stats} members={members} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
