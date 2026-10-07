"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Address } from "viem";
import { LoadError } from "@/components/ErrorPanel";
import { CoinIcon, CrownIcon, XLogoIcon } from "@/components/Icons";
import { SharePreviewDialog } from "@/components/SharePreviewDialog";
import { RewardsClaim } from "@/components/RewardsClaim";
import { SponsorEpoch } from "@/components/SponsorEpoch";
import { Tabs } from "@/components/Tabs";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useSponsorInfo } from "@/hooks/useSponsorFlow";
import { useClubRewards, useClubStandings } from "@/hooks/useRewards";
import { formatMon, shortAddress } from "@/lib/format";
import { recapLink } from "@/lib/recap";
import { DEFAULT_CLUB_RULES, PROTOCOL, percent, whoIsPaid, type PublishedSponsor } from "@/lib/rewards";
import { LiveStandings } from "./LiveStandings";
import { pts } from "./PointsMeter";
import { Empty, Loading, Panel } from "./parts";

const wei = (s: string | undefined) => BigInt(s ?? "0");

/** "Monad Foundation", "A and B", "A, B and 2 more". */
function names(sponsors: readonly PublishedSponsor[] | undefined): string[] {
  // A name is free text, so a wallet that paid is shown with it: the wallet is what the chain vouches for.
  return (sponsors ?? []).map((s) => `${s.sponsor}${s.kind === "owner" ? " (Owner)" : ""}${s.by ? ` · ${shortAddress(s.by)}` : ""}`);
}
const sponsoredBy = (list: string[]) =>
  list.length === 0 ? "" : list.length === 1 ? list[0]! : list.length === 2 ? `${list[0]} and ${list[1]}` : `${list[0]}, ${list[1]} and ${list.length - 2} more`;

type View = "overview" | "history";
const VIEWS = [
  { value: "overview", label: "Overview" },
  { value: "history", label: "History" },
] as const;

/**
 * The Rewards tab: how a Club's market pays its Holders and its Owner (ADR 0022). Every completed
 * swap in the Club pays the protocol fee; each epoch, part of it comes back here. Two views: the
 * running epoch and what you can claim (Overview), and what past epochs paid (History). How the
 * numbers are worked out is in the Guide.
 */
export function ClubRewards({ token, symbol, wallet, isOwner, now }: { token: string; symbol: string; wallet?: string; isOwner: boolean; now: number }) {
  const { data, isLoading, error } = useClubRewards(token);
  const { info: sponsor } = useSponsorInfo(token);
  const [sponsoring, setSponsoring] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // The open view lives in the URL (?view=history), like the Club's own tab.
  const view: View = search.get("view") === "history" ? "history" : "overview";
  const setView = (next: View) => {
    const params = new URLSearchParams(search);
    if (next === "overview") params.delete("view");
    else params.set("view", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  if (isLoading) return <Loading label="Loading rewards" rows={3} />;
  if (error) return <LoadError title="Couldn’t load rewards" error={error} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Rewards view" value={view} options={VIEWS} onChange={setView} />
        {sponsor?.enabled && !sponsoring && (
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setSponsoring(true)}>
            <CoinIcon className="size-4" />
            Sponsor this epoch
          </button>
        )}
      </div>
      {sponsoring && <SponsorEpoch token={token} symbol={symbol} isOwner={isOwner} onClose={() => setSponsoring(false)} />}
      {view === "overview" ? (
        <Overview data={data} token={token} symbol={symbol} wallet={wallet} isOwner={isOwner} now={now} />
      ) : (
        <History data={data} token={token} symbol={symbol} />
      )}
      <p className="text-xs text-muted">
        Rewards say this market has been busy, not that the asset is safe. Each epoch’s numbers and proofs are public, so anyone can check the payouts.
      </p>
    </div>
  );
}

type Data = ReturnType<typeof useClubRewards>["data"];

/** The running epoch and what you can claim. */
function Overview({ data, token, symbol, wallet, isOwner, now }: { data: Data; token: string; symbol: string; wallet?: string; isOwner: boolean; now: number }) {
  // The same read as the live standings (one request): the Club's own rules are what the copy states.
  const { standings } = useClubStandings(token, wallet);
  const rules = standings?.rules ?? DEFAULT_CLUB_RULES;
  return (
    <>
      <LiveStandings token={token} symbol={symbol} wallet={wallet} now={now} sponsoredBy={data?.open ? sponsoredBy(names(data.open.sponsors)) || undefined : undefined} />

      <Panel title={wallet ? "Your share" : "Your share (join to earn)"}>
        <RewardsClaim account={wallet as Address | undefined} club={token} />
        {isOwner && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <CrownIcon className="size-3.5" />
            As the Owner, the Club fund is paid to this wallet with your share.
          </p>
        )}
      </Panel>

      <Panel
        title="How this Club earns"
        action={
          <Link href="/guide/clubs#rewards" className="text-xs font-semibold underline underline-offset-2">
            How rewards work
          </Link>
        }
      >
        <p className="max-w-3xl text-sm">
          Every completed swap of {symbol} pays a small protocol fee. Each week, <strong>{percent(PROTOCOL.holderBps)}</strong> of it goes to {whoIsPaid(rules)}, split by the NFTs they held
          (on average over the week), and <strong>{percent(PROTOCOL.fundBps)}</strong> to the Club fund, which the Owner claims. Most points come from other people
          backing your posts and replies with their likes and answers: the Club’s Holders weigh most, and any verified account, even from another Club, adds a little.
          Posting, replying and liking, sharing on X and swapping add a little more. A Holder with no points isn’t paid that week; your whole
          share counts from {rules.rampPoints} points (less below that), and {rules.fullBonusPoints} points raise it by up to {percent(PROTOCOL.maxBonusBps)}.
          {rules.nonHolderBps > 0 && ` Members without NFTs share ${percent(rules.nonHolderBps)} of the Holder pool by their points.`} The Owner sets these rules; a change
          applies from the next week.
        </p>
      </Panel>
    </>
  );
}

/** What the latest epochs paid, who earned it, and the week's recap to share. */
function History({ data, token, symbol }: { data: Data; token: string; symbol: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [shareOpen, setShareOpen] = useState(false);
  const latest = data?.epochs[0];
  const rolling = wei(data?.carry.holders) + wei(data?.carry.fund);

  if (!data?.enabled || data.epochs.length === 0) {
    return (
      <Empty title="No epoch paid out yet">
        The first rewards land when an epoch closes after swaps in {symbol}.{rolling > 0n && ` ${formatMon(rolling)} is already waiting to roll in.`}
      </Empty>
    );
  }

  return (
    <>
      <Panel title={`Epoch ${latest!.n}`}>
        <dl className={`grid grid-cols-2 gap-4 text-sm ${latest!.sponsored ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
          <Figure label="Fees from swaps" value={formatMon(wei(latest!.fees))} />
          {latest!.sponsored && <Figure label="Sponsored" value={formatMon(wei(latest!.sponsored))} hint={sponsoredBy(names(latest!.sponsors))} />}
          <Figure label="To Holders" value={formatMon(wei(latest!.paidHolders))} hint={`${latest!.holderCount} ${latest!.holderCount === 1 ? "Holder" : "Holders"}`} />
          <Figure label="Club fund" value={formatMon(wei(latest!.paidFund))} />
          <Figure label="Rolls over" value={formatMon(rolling)} hint="No Holders or no Owner yet, plus rounding" />
        </dl>
      </Panel>

      <Panel title="Share the week">
        <p className="text-sm">
          Post this week’s numbers on X, then paste that post on the Board. It counts as your own X post about the Club (one a day), so it adds to your points.
        </p>
        <button type="button" className="btn-secondary mt-3 inline-flex items-center gap-2" onClick={() => setShareOpen(true)}>
          <XLogoIcon className="size-3.5" />
          Share the week
        </button>
        {shareOpen && origin && (
          <SharePreviewDialog
            imageUrl={`${origin}/clubs/${token}/opengraph-image`}
            shareUrl={recapLink(
              {
                symbol,
                epoch: latest!.n,
                fees: wei(latest!.fees),
                paidHolders: wei(latest!.paidHolders),
                holderCount: latest!.holderCount,
                sponsored: wei(latest!.sponsored),
                // Only names the operator recorded or the Owner paid under: anyone can type any name in the app.
                sponsors: (latest!.sponsors ?? []).filter((x) => !x.by || x.kind === "owner").map((x) => x.sponsor),
              },
              `${origin}/clubs/${token}`,
            )}
            title="Share the week"
            onClose={() => setShareOpen(false)}
          />
        )}
      </Panel>

      {data.earners.length > 0 && (
        <Panel title="Who earned">
          <ul className="divide-y divide-[#111318]/10">
            {data.earners.map((e) => (
              <li key={`${e.account}-${e.kind}`} className="flex items-center gap-3 py-2.5">
                <WalletAvatar seed={e.account} link />
                <span className="min-w-0 flex-1">
                  <Who address={e.account} />
                </span>
                {e.kind === "holder" && e.points !== undefined && <span className="chip chip-peach">{pts(e.points)}</span>}
                {e.kind === "fund" && (
                  <span className="chip chip-dark">
                    <CrownIcon />
                    Club fund
                  </span>
                )}
                <span className="font-black tabular-nums">{formatMon(wei(e.amount))}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.epochs.length > 1 && (
        <Panel title="Earlier epochs">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-semibold">Epoch</th>
                <th className="py-1 text-right font-semibold">Fees</th>
                <th className="py-1 text-right font-semibold">Holders</th>
                <th className="py-1 text-right font-semibold">Fund</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.epochs.slice(1).map((e) => (
                <tr key={e.n} className="border-t border-[#111318]/10">
                  <td className="py-1.5">{e.n}</td>
                  <td className="py-1.5 text-right">{formatMon(wei(e.fees))}</td>
                  <td className="py-1.5 text-right">{formatMon(wei(e.paidHolders))}</td>
                  <td className="py-1.5 text-right">{formatMon(wei(e.paidFund))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="mt-1 text-lg font-black tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}
