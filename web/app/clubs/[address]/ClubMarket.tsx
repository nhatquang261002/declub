"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { LoadError } from "@/components/ErrorPanel";
import { ListingGrid } from "@/components/IntentParts";
import { EmptyState } from "@/components/Page";
import { Tabs } from "@/components/Tabs";
import { Who } from "@/components/Who";
import { useClubMarket, MARKET_SCAN } from "@/hooks/useClubMarket";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { erc20Tokens } from "@/lib/assets";
import type { ActivityEvent } from "@/lib/clubs";
import { ON_DEAL_INTENTS_ADDRESS, explorerTx } from "@/lib/config";
import { ago } from "@/lib/format";

type View = "have" | "wanted" | "completed";

/** A completed swap links to its deal, or for a signed swap to its transaction. */
function swapHref(e: ActivityEvent) {
  const signed = !!ON_DEAL_INTENTS_ADDRESS && e.contract === ON_DEAL_INTENTS_ADDRESS.toLowerCase();
  return signed ? explorerTx(e.deal) : `/v2/deal/${e.deal}`;
}

function RecentSwaps({ events, now }: { events: readonly ActivityEvent[]; now: number }) {
  return (
    <ul className="page-section divide-y divide-line/60">
      {events.map((e) => {
        const href = swapHref(e);
        const external = href.startsWith("http");
        return (
          <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
            <span className="font-semibold">Swap</span>
            <span className="flex flex-wrap items-center gap-x-2 text-muted">
              {e.parties.map((p, i) => (
                <span key={p} className="inline-flex items-center gap-2">
                  {i > 0 && <span aria-hidden>↔</span>}
                  <Who address={p} plain />
                </span>
              ))}
            </span>
            <span className="ml-auto flex items-center gap-3 text-xs text-muted">
              <span>{ago(e.at, now)}</span>
              {external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
                  Transaction
                </a>
              ) : (
                <Link href={href} className="underline">
                  Deal #{e.deal}
                </Link>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What is on offer for the asset, and what has just traded (docs/09-clubs.md). */
export function ClubMarket({ token, recent, now }: { token: Address; recent: readonly ActivityEvent[]; now: number }) {
  const { address } = useConnection();
  const [view, setView] = useState<View>("have");
  const market = useClubMarket(token, now);

  const tokens = useMemo(
    () => erc20Tokens([...market.have, ...market.wanted].flatMap((d) => [...d.offered, ...d.requested])),
    [market.have, market.wanted],
  );
  const { info } = useTokenInfo(tokens);

  const options = [
    { value: "have" as const, label: `Have (${market.have.length})` },
    { value: "wanted" as const, label: `Wanted (${market.wanted.length})` },
    { value: "completed" as const, label: `Completed (${recent.length})` },
  ];
  const listings = view === "have" ? market.have : market.wanted;

  return (
    <section className="mt-8" aria-label="Market">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Market</h2>
        <Tabs label="Market view" value={view} options={options} onChange={setView} />
      </div>

      {market.error && view !== "completed" ? (
        <LoadError title="Couldn't load deals" error={market.error} />
      ) : view === "completed" ? (
        recent.length === 0 ? (
          <EmptyState>No completed swaps seen yet. They show up here as soon as one finishes.</EmptyState>
        ) : (
          <RecentSwaps events={recent} now={now} />
        )
      ) : market.isLoading ? (
        <EmptyState>Loading deals…</EmptyState>
      ) : listings.length === 0 ? (
        <EmptyState>
          {view === "have" ? "Nobody is offering this right now." : "Nobody is asking for this right now."}
        </EmptyState>
      ) : (
        <ListingGrid listings={listings} now={now} me={address} info={info} />
      )}

      {view !== "completed" && (
        <p className="mt-3 text-xs text-muted">
          {market.truncated && `Looked through the newest ${MARKET_SCAN} deals; older ones aren't searched. `}
          {market.poolError ? "The signed-swap pool isn't answering, so signed swaps are missing." : null}
        </p>
      )}
    </section>
  );
}
