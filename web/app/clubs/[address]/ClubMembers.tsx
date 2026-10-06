"use client";

import { useState } from "react";
import { ActionMenu, type MenuAction } from "@/components/ActionMenu";
import { LoadError } from "@/components/ErrorPanel";
import { Pills } from "@/components/Pills";
import { HolderBadge } from "@/components/HolderBadge";
import { BanIcon, CrownIcon, FlameIcon, ShieldIcon } from "@/components/Icons";
import { formatMomentum } from "@/components/MomentumBadge";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubActions } from "@/hooks/useClubBoard";
import { useClubMembers, useClubMembership, type ViewerRole } from "@/hooks/useClubMembership";
import { useFollows } from "@/hooks/useSocial";
import { FollowButton } from "@/components/FollowButton";
import { isOwnerOrAdmin, mayActOn } from "@/lib/clubRoles";
import { ago } from "@/lib/format";
import type { MemberSort, PublicMember } from "@/lib/members";
import { Empty, Loading } from "./parts";

const SORTS = [
  { value: "momentum", label: "Most active" },
  { value: "new", label: "Newest" },
] as const;

/** The top three get a podium once three members have traded. */
const PODIUM = 3;

export function RoleChip({ role }: { role?: PublicMember["role"] }) {
  if (role === "owner") {
    return (
      <span className="chip chip-dark">
        <CrownIcon />
        Owner
      </span>
    );
  }
  if (role === "moderator") {
    return (
      <span className="chip chip-blue">
        <ShieldIcon />
        Moderator
      </span>
    );
  }
  return null;
}

/** Epochs in a row of posting on the Board (ADR 0032); shown from the second. */
export function StreakChip({ streak }: { streak?: number }) {
  if (!streak || streak < 2) return null;
  return (
    <span className="chip chip-peach" title={`Active on the Board ${streak} epochs in a row`}>
      <FlameIcon />
      {streak} wk
    </span>
  );
}

/** What the viewer's role lets them do to this member, by the rule the server applies too. */
function staffActions(viewer: ViewerRole | undefined, m: PublicMember, actions: ReturnType<typeof useClubActions>): MenuAction[][] {
  if (!viewer) return [];
  const target = m.role ?? "member";
  if (!mayActOn(viewer, target)) return [];
  const roles: MenuAction[] = [];
  if (isOwnerOrAdmin(viewer) && target !== "owner") {
    roles.push({
      label: target === "moderator" ? "Remove moderator" : "Make moderator",
      icon: <ShieldIcon />,
      onSelect: () => actions.role.mutate({ wallet: m.wallet, role: target === "moderator" ? null : "moderator" }),
    });
  }
  if (viewer === "owner" && target !== "owner") {
    roles.push({
      label: "Hand over the Club",
      icon: <CrownIcon />,
      confirm: "Hand the Club to this member? You become a regular member.",
      onSelect: () => actions.role.mutate({ wallet: m.wallet, role: "owner" }),
    });
  }
  const ban: MenuAction = {
    label: "Ban from the Club",
    icon: <BanIcon />,
    danger: true,
    confirm: "Ban this member from the Club? They are removed and can’t rejoin.",
    onSelect: () => actions.ban.mutate({ wallet: m.wallet }),
  };
  return [roles, [ban]];
}

function Podium({
  members,
  symbol,
  mine,
  menu,
}: {
  members: PublicMember[];
  symbol: string;
  mine?: string;
  /** Staff only: the actions on a member. */
  menu?: (m: PublicMember) => MenuAction[][];
}) {
  // In a row the winner stands in the middle and highest; stacked on a phone, it's simply first.
  const place = ["sm:order-2", "sm:order-1 sm:mt-6", "sm:order-3 sm:mt-10"];
  return (
    <ol className="mb-5 grid gap-3 sm:grid-cols-3 sm:items-start" aria-label="Top three traders">
      {members.slice(0, PODIUM).map((m, i) => {
        return (
          <li key={m.wallet} className={`club-panel relative flex flex-col items-center gap-2 px-4 py-5 text-center ${place[i]}`}>
            {menu && mine !== m.wallet && (
              <span className="absolute top-2 right-2">
                <ActionMenu label="Member actions" groups={menu(m)} />
              </span>
            )}
            <span className={`rank rank-${i + 1}`}>{i + 1}</span>
            <WalletAvatar seed={m.wallet} size={i === 0 ? "3.5rem" : "3rem"} />
            <span className="max-w-full truncate text-sm">
              <Who address={m.wallet} mine={mine === m.wallet} />
            </span>
            <span className="text-2xl font-black tabular-nums">{formatMomentum(m.momentum)}</span>
            <span className="flex flex-wrap justify-center gap-1.5">
              <RoleChip role={m.role} />
              {m.holder && <HolderBadge symbol={symbol} />}
              <StreakChip streak={m.streak} />
            </span>
            <span className="text-xs text-muted">
              {m.swaps} {m.swaps === 1 ? "swap" : "swaps"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The Club's leaderboard: members ranked by what their wallets added to its Momentum. */
export function ClubMembers({ token, symbol, now }: { token: string; symbol: string; now: number }) {
  const [sort, setSort] = useState<MemberSort>("momentum");
  const { view, isLoading, error } = useClubMembers(token, sort);
  const me = useClubMembership(token);
  const actions = useClubActions(token);
  const follows = useFollows();
  const staff = me.role !== undefined && me.role !== "member";

  if (error && !view) return <LoadError title="Couldn’t load the members" error={error} />;
  if (view && view.enabled === false) {
    return <Empty title="No members list on this server">This server isn’t keeping Club memberships.</Empty>;
  }

  const members = view?.members ?? [];
  const podium = sort === "momentum" && members.length >= PODIUM && members[PODIUM - 1].momentum > 0;
  const rest = podium ? members.slice(PODIUM) : members;
  const top = Math.max(1, members[0]?.momentum ?? 0);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Pills value={sort} options={SORTS} onChange={setSort} label="Sort members" />
        {view && (
          <p className="text-sm text-muted">
            <strong className="text-[#111318]">{view.total.toLocaleString()}</strong> {view.total === 1 ? "member" : "members"} ·{" "}
            <strong className="text-[#111318]">{view.holders.toLocaleString()}</strong> {view.holders === 1 ? "holds" : "hold"} {symbol}
          </p>
        )}
      </div>

      {isLoading ? (
        <Loading label="Loading members" rows={5} />
      ) : members.length === 0 ? (
        <Empty title="No members yet">Join to be the first on the list.</Empty>
      ) : (
        <>
          {podium && (
            <Podium members={members} symbol={symbol} mine={me.wallet} menu={staff ? (m) => staffActions(me.role, m, actions) : undefined} />
          )}
          {rest.length > 0 && (
            <ol className="club-panel divide-y divide-[#111318]/10 club-list" start={podium ? PODIUM + 1 : 1}>
              {rest.map((m, i) => {
                const rank = i + 1 + (podium ? PODIUM : 0);
                const mine = me.wallet === m.wallet;
                return (
                  <li key={m.wallet} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${mine ? "bg-white/70" : ""}`}>
                    {sort === "momentum" && <span className={`rank ${rank <= 3 && m.momentum > 0 ? `rank-${rank}` : ""}`}>{rank}</span>}
                    <WalletAvatar seed={m.wallet} size="2.25rem" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <Who address={m.wallet} mine={mine} />
                        <FollowButton target={m.wallet} follows={follows} />
                        <RoleChip role={m.role} />
                        {m.holder && <HolderBadge symbol={symbol} />}
                        <StreakChip streak={m.streak} />
                      </div>
                      <p className="text-xs text-muted">
                        Joined {ago(Math.floor(m.joinedAt / 1000), now)} · {m.swaps} {m.swaps === 1 ? "swap" : "swaps"}
                      </p>
                    </div>
                    <div className="flex w-20 flex-col items-end gap-1 sm:w-28">
                      <span className="font-black tabular-nums">{formatMomentum(m.momentum)}</span>
                      {sort === "momentum" && (
                        <span className="meter w-full" aria-hidden>
                          <span style={{ width: `${m.momentum > 0 ? Math.max(3, (m.momentum / top) * 100) : 0}%` }} />
                        </span>
                      )}
                    </div>
                    {staff && (
                      <span className="w-8">{!mine && <ActionMenu label="Member actions" groups={staffActions(me.role, m, actions)} />}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
      {view && view.total > members.length && (
        <p className="mt-3 text-xs text-muted">
          Showing the first {members.length} of {view.total.toLocaleString()}.
        </p>
      )}
    </>
  );
}
