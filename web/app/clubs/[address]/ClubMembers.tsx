"use client";

import { useState } from "react";
import { LoadError } from "@/components/ErrorPanel";
import { HolderBadge } from "@/components/HolderBadge";
import { formatMomentum } from "@/components/MomentumBadge";
import { EmptyState } from "@/components/Page";
import { Tabs } from "@/components/Tabs";
import { Who } from "@/components/Who";
import { useClubActions } from "@/hooks/useClubBoard";
import { useClubMembers, useClubMembership } from "@/hooks/useClubMembership";
import { isOwnerOrAdmin, isStaff } from "@/lib/clubRoles";
import type { MemberSort } from "@/lib/members";
import { ago } from "@/lib/format";

const SORTS = [
  { value: "momentum", label: "Top Momentum" },
  { value: "new", label: "Newest" },
] as const;

/** The Club's leaderboard: members ranked by what their wallets added to its Momentum. */
export function ClubMembers({ token, symbol, now }: { token: string; symbol: string; now: number }) {
  const [sort, setSort] = useState<MemberSort>("momentum");
  const { view, isLoading, error } = useClubMembers(token, sort);
  const me = useClubMembership(token);
  const { role, ban } = useClubActions(token);
  const staff = me.role !== undefined && isStaff(me.role);
  const owner = me.role !== undefined && isOwnerOrAdmin(me.role);
  const confirm = (message: string, run: () => void) => {
    if (window.confirm(message)) run();
  };

  if (error && !view) return <LoadError title="Couldn’t load the members" error={error} />;
  if (view && view.enabled === false) {
    return <EmptyState>This server isn’t keeping Club memberships, so there is no members list.</EmptyState>;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={sort} options={SORTS} onChange={setSort} label="Sort members" />
        {view && (
          <p className="text-sm text-muted">
            {view.total.toLocaleString()} {view.total === 1 ? "member" : "members"} · {view.holders.toLocaleString()} {view.holders === 1 ? "holder" : "holders"}
          </p>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted">Loading members…</p>
      ) : !view || view.members.length === 0 ? (
        <EmptyState>No members yet. Be the first to join.</EmptyState>
      ) : (
        <ol className="page-section divide-y divide-line/60">
          {view.members.map((m, i) => (
            <li key={m.wallet} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              {sort === "momentum" && <span className="w-6 text-right font-bold text-muted tabular-nums">{i + 1}</span>}
              <span className="min-w-0 flex-1">
                <Who address={m.wallet} mine={me.wallet === m.wallet} />
              </span>
              {m.role && <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold capitalize">{m.role}</span>}
              {m.holder && <HolderBadge symbol={symbol} />}
              <span className="text-xs text-muted">joined {ago(Math.floor(m.joinedAt / 1000), now)}</span>
              <span className="w-24 text-right tabular-nums">
                <span className="font-bold">{formatMomentum(m.momentum)}</span>
                <span className="text-xs text-muted"> · {m.swaps} {m.swaps === 1 ? "swap" : "swaps"}</span>
              </span>
              {staff && me.wallet !== m.wallet && (
                <span className="flex w-full flex-wrap justify-end gap-x-3 text-xs text-muted">
                  {owner && m.role !== "owner" && (
                    <button type="button" className="underline" onClick={() => role.mutate({ wallet: m.wallet, role: m.role === "moderator" ? null : "moderator" })}>
                      {m.role === "moderator" ? "Remove moderator" : "Make moderator"}
                    </button>
                  )}
                  {me.role === "owner" && m.role !== "owner" && (
                    <button type="button" className="underline" onClick={() => confirm("Hand the Club to this member? You become a regular member.", () => role.mutate({ wallet: m.wallet, role: "owner" }))}>
                      Hand over the Club
                    </button>
                  )}
                  <button type="button" className="underline" onClick={() => confirm("Ban this member from the Club? They are removed and can’t rejoin.", () => ban.mutate({ wallet: m.wallet }))}>
                    Ban
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {view && view.total > view.members.length && (
        <p className="mt-3 text-xs text-muted">Showing the first {view.members.length} of {view.total.toLocaleString()}.</p>
      )}
    </>
  );
}
