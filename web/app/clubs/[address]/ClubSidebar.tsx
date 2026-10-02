"use client";

import { useEffect, useState } from "react";
import { getAddress } from "viem";
import { CheckIcon, CopyIcon, ExternalIcon } from "@/components/Icons";
import { formatMomentum, HeatBars, MOMENTUM_EXPLAINED } from "@/components/MomentumBadge";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { KIND_LABEL } from "@/components/ClubCard";
import { useClubMembers } from "@/hooks/useClubMembership";
import { HEAT, heat, infoAssets, type ClubInfo, type ClubStats } from "@/lib/clubs";
import { explorerAddress } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { Panel } from "./parts";

/** Where this Club sits on the heat scale, every step shown so the word has something to compare to. */
function HeatPanel({ stats }: { stats?: ClubStats }) {
  const current = stats ? heat(stats.momentum).level : -1;
  return (
    <Panel title="How busy it is">
      <ol className="flex flex-col-reverse gap-1" aria-label="Heat scale, by Momentum">
        {HEAT.map((step, level) => (
          <li
            key={step.label}
            className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${
              level === current ? "bg-white font-extrabold ring-2 ring-[#111318]" : "text-muted"
            }`}
            aria-current={level === current ? "true" : undefined}
          >
            <span className="flex items-center gap-2">
              <HeatBars level={level} />
              {step.label}
              {level === current && <span className="sr-only">(this Club)</span>}
            </span>
            <span className="tabular-nums">{level === 0 ? "0" : `${step.min}+`}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-5 text-muted">
        {stats ? `Momentum ${formatMomentum(stats.momentum)}. ` : "Momentum isn’t available right now. "}
        {MOMENTUM_EXPLAINED}
      </p>
    </Panel>
  );
}

const TOP = 5;

/** The top of the leaderboard, with a way to the whole of it. */
function TopTraders({ token, onSeeAll }: { token: string; onSeeAll: () => void }) {
  const { view } = useClubMembers(token, "momentum");
  if (view?.enabled === false) return null;
  const top = (view?.members ?? []).filter((m) => m.momentum > 0).slice(0, TOP);
  return (
    <Panel
      title="Top traders"
      action={
        (view?.total ?? 0) > 0 && (
          <button type="button" className="text-xs font-bold text-[#a9282f] hover:underline" onClick={onSeeAll}>
            All members →
          </button>
        )
      }
    >
      {top.length === 0 ? (
        <p className="text-sm text-muted">Nobody has traded here yet. Finish a swap and you’re on top.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {top.map((m, i) => (
            <li key={m.wallet} className="flex items-center gap-2.5 text-sm">
              <span className={`rank rank-${i + 1} size-6 text-[0.7rem]`}>{i + 1}</span>
              <WalletAvatar seed={m.wallet} size="1.6rem" />
              <span className="min-w-0 flex-1 truncate">
                <Who address={m.wallet} />
              </span>
              <span className="font-extrabold tabular-nums">{formatMomentum(m.momentum)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Copies text, and says so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="icon-btn size-7"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
    >
      {copied ? <CheckIcon className="size-4 text-[#1f7a55]" /> : <CopyIcon className="size-4" />}
    </button>
  );
}

/** What the Club's assets are, and why they are on the verified list. */
function Details({ club }: { club: ClubInfo }) {
  const assets = infoAssets(club);
  return (
    <Panel title="Details">
      <dl className="flex flex-col gap-3 text-sm">
        {assets.map((asset) => {
          const address = getAddress(asset.token);
          return (
            <div key={asset.token}>
              <dt className="text-xs text-muted">
                {assets.length > 1 ? `${asset.symbol} · ${KIND_LABEL[asset.kind]}` : "Contract"} ({asset.kind === "erc721" ? "ERC-721" : "ERC-20"})
              </dt>
              <dd className="flex items-center gap-1">
                <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs font-bold">
                  {shortAddress(address)}
                  <ExternalIcon className="size-3.5" />
                </a>
                <CopyButton text={address} label={`Copy the ${asset.symbol} contract address`} />
              </dd>
            </div>
          );
        })}
        {assets.length > 1 ? (
          <div>
            <dt className="text-xs text-muted">Shared Club</dt>
            <dd className="leading-5">Deals in either count toward its Momentum, and holding either earns the Holder badge.</dd>
          </div>
        ) : (
          <div>
            <dt className="text-xs text-muted">Kind</dt>
            <dd className="font-semibold">{KIND_LABEL[club.kind]}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted">Why it’s verified</dt>
          <dd className="leading-5">{club.note}</dd>
        </div>
      </dl>
    </Panel>
  );
}

/** The Club page's side column: the heat scale, the top traders (except beside the full list) and the asset's details. */
export function ClubSidebar({
  club,
  stats,
  onSeeMembers,
}: {
  club: ClubInfo;
  stats?: ClubStats;
  /** Opens the Members tab; left out while it is open, and the top traders with it. */
  onSeeMembers?: () => void;
}) {
  return (
    <aside className="flex flex-col gap-5">
      <HeatPanel stats={stats} />
      {onSeeMembers && <TopTraders token={club.token} onSeeAll={onSeeMembers} />}
      <Details club={club} />
    </aside>
  );
}
