"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { isAddress } from "viem";
import { Alert } from "@/components/Alert";
import { ClubAvatar, ClubCover } from "@/components/ClubArt";
import { clubLabel } from "@/components/ClubCard";
import { ArrowLeftIcon, BadgeCheckIcon, ChatIcon, LinkIcon, ShieldIcon, TagIcon, UsersIcon } from "@/components/Icons";
import { JoinClubButton } from "@/components/JoinClubButton";
import { formatMomentum, HeatMeter, MomentumChange, MOMENTUM_EXPLAINED } from "@/components/MomentumBadge";
import { Tooltip } from "@/components/Tooltip";
import { useClubActions, useClubPage, useClubPosts } from "@/hooks/useClubBoard";
import { useClubMarket } from "@/hooks/useClubMarket";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useClub } from "@/hooks/useClubs";
import { useNow } from "@/hooks/useNow";
import { toClubInfo } from "@/lib/clubs";
import { ago } from "@/lib/format";
import { registry, type ClubEntry } from "@/lib/verifiedAssets";
import { ClubBoard } from "./ClubBoard";
import { ClubManage } from "./ClubManage";
import { ClubMarket } from "./ClubMarket";
import { ClubMembers } from "./ClubMembers";
import { ClubSidebar } from "./ClubSidebar";

export default function ClubPage() {
  const params = useParams<{ address: string }>();
  const router = useRouter();
  const entry = isAddress(params.address, { strict: false }) ? registry.clubFor(params.address) : null;
  // A memecoin that shares a collection's Club opens it at the Club's own address, and the other way round.
  const home = entry && entry.address.toLowerCase() !== params.address.toLowerCase() ? entry.address.toLowerCase() : null;
  useEffect(() => {
    if (home) router.replace(`/clubs/${home}${window.location.search}`);
  }, [home, router]);
  if (!entry) {
    return (
      <div className="club-panel mx-auto max-w-md px-6 py-12 text-center">
        <p className="text-lg font-black">No Club here</p>
        <p className="mt-1 text-sm text-muted">There is no Club for this address. Clubs are for verified NFT collections and memecoins: a stablecoin or wrapped MON has none.</p>
        <Link href="/clubs" className="btn-primary mt-5">
          See all Clubs
        </Link>
      </div>
    );
  }
  // The open tab lives in the URL (?tab=board), so a section can be linked and survives a reload.
  return (
    <Suspense>
      <Club entry={entry} />
    </Suspense>
  );
}

type Tab = "market" | "board" | "members" | "manage";
const TABS: readonly Tab[] = ["market", "board", "members", "manage"];

function Stat({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="club-stat">
      <dt>{label}</dt>
      <dd>
        {children}
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  );
}

/** A link as it is shown: its address without the scheme, so people see where it goes. */
const linkText = (href: string) => href.replace(/^https:\/\//, "").replace(/\/$/, "");

function Club({ entry }: { entry: ClubEntry }) {
  const now = useNow(30_000);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const info = toClubInfo(entry);
  // What holding means here: either asset of a paired Club counts.
  const held = info.linked ? `${info.symbol} or ${info.linked.symbol}` : info.symbol;
  const { club, recent, holders, logging, error } = useClub(entry.address);
  const stats = club?.stats;
  const me = useClubMembership(entry.address);
  const page = useClubPage(entry.address);
  const market = useClubMarket([entry.address, entry.linked?.address], now);
  const board = useClubPosts(entry.address);
  const { claim } = useClubActions(entry.address);
  const staff = me.role !== undefined && me.role !== "member";

  const asked = search.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) && (asked !== "manage" || staff) ? asked : "market";
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(search);
    if (next === "market") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const tabs: { value: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { value: "market", label: "Market", icon: <TagIcon />, count: market.isLoading ? undefined : market.have.length + market.wanted.length },
    { value: "board", label: "Board", icon: <ChatIcon />, count: board.enabled && !board.isLoading ? board.posts.length : undefined },
    { value: "members", label: "Members", icon: <UsersIcon />, count: club?.members },
    ...(staff ? [{ value: "manage" as const, label: "Manage", icon: <ShieldIcon /> }] : []),
  ];

  return (
    <>
      <Link href="/clubs" className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-[#111318]">
        <ArrowLeftIcon className="size-4" />
        All Clubs
      </Link>

      <header className="club-hero">
        <ClubCover club={info} className="h-28 sm:h-40">
          {info.archived && (
            <div className="relative z-10 flex justify-end p-3">
              <span className="chip">Archived</span>
            </div>
          )}
        </ClubCover>

        <div className="px-5 pb-6 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <ClubAvatar
              club={info}
              className="relative z-10 -mt-12 size-24 text-3xl shadow-[0.3rem_0.3rem_0_#111318] sm:-mt-16 sm:size-32 sm:text-4xl"
              sizes="128px"
            />
            <div className="min-w-0 flex-1 sm:pb-1">
              <h1 className="flex items-center gap-2 text-3xl leading-tight font-black tracking-tight sm:text-4xl">
                <span className="min-w-0 break-words">{info.name}</span>
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted">
                <span className="font-semibold">{clubLabel(info)}</span>
                <Tooltip content={`On On Deal’s verified list: ${info.note}`}>
                  <span className="chip chip-blue">
                    <BadgeCheckIcon />
                    Verified
                  </span>
                </Tooltip>
                {stats && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{stats.lastActive != null ? `Active ${ago(stats.lastActive, now)}` : "No trades yet"}</span>
                  </>
                )}
              </p>
            </div>
            <div className="sm:pb-1">
              <JoinClubButton token={entry.address} symbol={held} archived={info.archived} />
            </div>
          </div>

          {page?.description && <p className="mt-5 max-w-3xl text-[0.95rem] leading-7 break-words whitespace-pre-wrap">{page.description}</p>}
          {(page?.links.length ?? 0) > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {page!.links.map((href) => (
                <li key={href}>
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="chip py-1">
                    <LinkIcon />
                    {linkText(href)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <dl className="club-stats">
          <Stat
            label={
              <Tooltip content={MOMENTUM_EXPLAINED}>
                <span className="uppercase underline decoration-dotted underline-offset-2">Momentum</span>
              </Tooltip>
            }
          >
            {stats ? (
              <span className="flex items-baseline gap-2">
                {formatMomentum(stats.momentum)}
                <MomentumChange change={stats.change} />
              </span>
            ) : error ? (
              "—"
            ) : (
              "…"
            )}
          </Stat>
          <Stat label="Members" hint={club ? `${holders.toLocaleString()} ${holders === 1 ? "holder" : "holders"}` : undefined}>
            {club ? club.members.toLocaleString() : "…"}
          </Stat>
          <Stat label="Swaps · 7 days">{stats ? stats.completed7d.toLocaleString() : "…"}</Stat>
          <Stat label="New deals · 7 days">{stats ? stats.created7d.toLocaleString() : "…"}</Stat>
          <Stat label="Traders · 30 days">{stats ? stats.traders30d.toLocaleString() : "…"}</Stat>
          <Stat label="Heat">{stats ? <HeatMeter value={stats.momentum} /> : "…"}</Stat>
        </dl>
      </header>

      <div className="mt-5 flex flex-col gap-3 empty:hidden">
        {me.member && page?.hasOwner === false && (
          <Alert
            tone="info"
            title="This Club has no Owner yet"
            actions={
              <button type="button" className="alert-link" disabled={claim.isPending} onClick={() => claim.mutate()}>
                {claim.isPending ? "Claiming…" : "Claim it"}
              </button>
            }
          >
            If you own the {info.symbol} contract, claim the Club with the wallet that is its owner().
          </Alert>
        )}
        {info.archived && (
          <Alert tone="warn" title="This Club is archived">
            It stays readable, but it is no longer being updated.
          </Alert>
        )}
        {logging === false && (
          <Alert tone="info" title="Signed swaps only">
            This server isn’t keeping an activity log, so Momentum counts signed swaps only.
          </Alert>
        )}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <div className="tabbar mb-6 flex w-full sm:inline-flex sm:w-auto" role="group" aria-label="Club sections">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                className="tab inline-flex flex-1 items-center justify-center gap-1.5 sm:flex-none"
                aria-pressed={tab === t.value}
                onClick={() => setTab(t.value)}
              >
                <span className="hidden sm:inline [&_svg]:size-4">{t.icon}</span>
                {t.label}
                {t.count !== undefined && <span className="tab-count">{t.count.toLocaleString()}</span>}
              </button>
            ))}
          </div>

          {tab === "market" && <ClubMarket market={market} symbol={held} recent={recent} now={now} />}
          {tab === "board" && <ClubBoard token={entry.address} symbol={held} archived={info.archived} now={now} />}
          {tab === "members" && <ClubMembers token={entry.address} symbol={held} now={now} />}
          {tab === "manage" && me.role && staff && <ClubManage token={entry.address} role={me.role} now={now} />}
        </div>

        <ClubSidebar club={info} stats={stats} onSeeMembers={tab === "members" ? undefined : () => setTab("members")} />
      </div>
    </>
  );
}
