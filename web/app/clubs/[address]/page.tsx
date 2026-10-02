"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { ClubTile, KIND_LABEL } from "@/components/ClubCard";
import { JoinClubButton } from "@/components/JoinClubButton";
import { MomentumBadge } from "@/components/MomentumBadge";
import { EmptyState } from "@/components/Page";
import { Tabs } from "@/components/Tabs";
import { useClubActions, useClubPage } from "@/hooks/useClubBoard";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useClub } from "@/hooks/useClubs";
import { useNow } from "@/hooks/useNow";
import { toClubInfo } from "@/lib/clubs";
import { explorerAddress } from "@/lib/config";
import { ago, shortAddress } from "@/lib/format";
import { registry, type AssetEntry } from "@/lib/verifiedAssets";
import { ClubBoard } from "./ClubBoard";
import { ClubManage } from "./ClubManage";
import { ClubMarket } from "./ClubMarket";
import { ClubMembers } from "./ClubMembers";

export default function ClubPage() {
  const params = useParams<{ address: string }>();
  const entry = isAddress(params.address, { strict: false }) ? registry.clubFor(params.address) : null;
  if (!entry) {
    return (
      <EmptyState>
        There is no Club for this address. <Link href="/clubs">See all Clubs</Link>
      </EmptyState>
    );
  }
  return <Club entry={entry} />;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

const BASE_TABS = [
  { value: "market", label: "Market" },
  { value: "board", label: "Board" },
  { value: "members", label: "Members" },
] as const;
type Tab = (typeof BASE_TABS)[number]["value"] | "manage";

/** A link as it is shown: its address without the scheme, so people see where it goes. */
const linkText = (href: string) => href.replace(/^https:\/\//, "").replace(/\/$/, "");

function Club({ entry }: { entry: AssetEntry }) {
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>("market");
  const info = toClubInfo(entry);
  const { club, recent, holders, logging, error } = useClub(entry.address);
  const stats = club?.stats;
  const me = useClubMembership(entry.address);
  const page = useClubPage(entry.address);
  const { claim } = useClubActions(entry.address);
  const staff = me.role !== undefined && me.role !== "member";
  const tabs = staff ? [...BASE_TABS, { value: "manage" as const, label: "Manage" }] : BASE_TABS;

  return (
    <>
      <Link href="/clubs" className="text-sm text-muted underline">
        ← All Clubs
      </Link>
      <header className="page-section mt-3 flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <ClubTile name={info.name} className="size-16 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">{info.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>
              {info.symbol} · {KIND_LABEL[info.kind]}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs" title={info.note}>
              Verified
            </span>
            {info.archived && <span className="rounded-full border border-line px-2 py-0.5 text-xs">Archived</span>}
            <a href={explorerAddress(entry.address)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs underline">
              {shortAddress(getAddress(entry.address))}
            </a>
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:items-end">
          <div className="sm:text-right">
            <p className="text-xs text-muted">Momentum</p>
            {stats ? <MomentumBadge value={stats.momentum} change={stats.change} explain /> : <span className="text-sm text-muted">{error ? "Unavailable" : "…"}</span>}
          </div>
          <JoinClubButton token={entry.address} symbol={info.symbol} archived={info.archived} />
        </div>
      </header>

      {(page?.description || (page?.links.length ?? 0) > 0) && (
        <section className="page-section mt-3 px-6 py-4 text-sm">
          {page?.description && <p className="break-words whitespace-pre-wrap">{page.description}</p>}
          {(page?.links.length ?? 0) > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {page!.links.map((href) => (
                <li key={href}>
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                    {linkText(href)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {me.member && page?.hasOwner === false && (
        <p className="mt-3 text-sm text-muted">
          This Club has no Owner yet. If you own the {info.symbol} contract,{" "}
          <button type="button" className="underline" disabled={claim.isPending} onClick={() => claim.mutate()}>
            claim it
          </button>{" "}
          with the wallet that is its owner().
        </p>
      )}

      {stats && (
        <dl className="page-section mt-3 grid grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Members" value={club.members} />
          <Stat label="Holders" value={holders} />
          <Stat label="Swaps, last 7 days" value={stats.completed7d} />
          <Stat label="New deals, last 7 days" value={stats.created7d} />
          <Stat label="Traders, last 30 days" value={stats.traders30d} />
          <Stat label="Last activity" value={stats.lastActive != null ? ago(stats.lastActive, now) : "none yet"} />
        </dl>
      )}
      {logging === false && (
        <p className="mt-3 text-xs text-muted">This server isn’t keeping an activity log, so Momentum counts signed swaps only.</p>
      )}
      {info.archived && (
        <p className="mt-3 text-sm text-warn">This Club is archived: it stays readable, but it is no longer being updated.</p>
      )}

      <Tabs value={tab} options={tabs} onChange={setTab} label="Club sections" className="mt-6 mb-4" />
      {tab === "market" && <ClubMarket token={entry.address} recent={recent} now={now} />}
      {tab === "board" && <ClubBoard token={entry.address} archived={info.archived} now={now} />}
      {tab === "members" && <ClubMembers token={entry.address} symbol={info.symbol} now={now} />}
      {tab === "manage" && me.role && staff && <ClubManage token={entry.address} role={me.role} now={now} />}
    </>
  );
}
