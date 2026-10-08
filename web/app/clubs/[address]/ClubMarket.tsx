"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { CreateDealButton } from "@/components/CreateDealButton";
import { LoadError } from "@/components/ErrorPanel";
import { Pills } from "@/components/Pills";
import { ExternalIcon, SwapIcon } from "@/components/Icons";
import { ListingGrid } from "@/components/IntentParts";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { MARKET_SIZE, type useClubMarket } from "@/hooks/useClubMarket";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { erc20Tokens } from "@/lib/assets";
import type { ActivityEvent } from "@/lib/clubs";
import { DECLUB_INTENTS_ADDRESS, explorerTx } from "@/lib/config";
import { ago } from "@/lib/format";
import { Empty, Loading } from "./parts";

type View = "have" | "wanted" | "completed";
type Market = ReturnType<typeof useClubMarket>;

/** A completed swap links to its deal, or for a signed swap to its transaction. */
function swapHref(e: ActivityEvent) {
  const signed = !!DECLUB_INTENTS_ADDRESS && e.contract === DECLUB_INTENTS_ADDRESS.toLowerCase();
  return signed ? explorerTx(e.deal) : `/deal/${e.deal}`;
}

function RecentSwaps({ events, now }: { events: readonly ActivityEvent[]; now: number }) {
  return (
    <ul className="club-panel divide-y divide-[#111318]/10">
      {events.map((e) => {
        const href = swapHref(e);
        const external = href.startsWith("http");
        return (
          <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-sm">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-[#78c7a5]" aria-hidden>
              <SwapIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {e.parties.map((p, i) => (
                  <span key={p} className="inline-flex items-center gap-1.5">
                    {i > 0 && (
                      <span aria-label="swapped with" className="text-muted">
                        ⇄
                      </span>
                    )}
                    <WalletAvatar seed={p} size="1.25rem" />
                    <Who address={p} plain />
                  </span>
                ))}
              </span>
              <span className="text-xs text-muted">Swapped {ago(e.at, now)}</span>
            </span>
            {external ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold">
                Transaction <ExternalIcon className="size-3.5" />
              </a>
            ) : (
              <Link href={href} className="text-xs font-bold">
                Deal #{e.deal} →
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What is on offer for the asset, and what has just traded (docs/09-clubs.md). */
export function ClubMarket({ market, symbol, recent, now }: { market: Market; symbol: string; recent: readonly ActivityEvent[]; now: number }) {
  const { address } = useConnection();
  const [view, setView] = useState<View>("have");

  const tokens = useMemo(() => erc20Tokens([...market.have, ...market.wanted].flatMap((d) => [...d.offered, ...d.requested])), [market.have, market.wanted]);
  const { info } = useTokenInfo(tokens);

  const options = [
    { value: "have" as const, label: "For trade", count: market.have.length },
    { value: "wanted" as const, label: "Wanted", count: market.wanted.length },
    { value: "completed" as const, label: "Recent swaps", count: recent.length },
  ];
  const listings = view === "have" ? market.have : market.wanted;
  // An empty list offers its own Create button; a full one gets it beside the switch.
  const showCreate = view !== "completed" && !market.isLoading && !market.error && listings.length > 0;

  return (
    <section aria-label="Market">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Pills label="Market view" value={view} options={options} onChange={setView} />
        {showCreate && <CreateDealButton />}
      </div>

      {market.error && view !== "completed" ? (
        <LoadError title="Couldn't load deals" error={market.error} />
      ) : view === "completed" ? (
        recent.length === 0 ? (
          <Empty title="No swaps yet">Completed trades of {symbol} show up here the moment they settle.</Empty>
        ) : (
          <RecentSwaps events={recent} now={now} />
        )
      ) : market.isLoading ? (
        <Loading label="Loading deals" />
      ) : listings.length === 0 ? (
        <Empty title={view === "have" ? `Nobody is offering ${symbol} right now` : `Nobody is asking for ${symbol} right now`} action={<CreateDealButton />}>
          {view === "have" ? `Have some? Put ${symbol} up and name what you want for it.` : `Want some? Make an offer for ${symbol} and holders can take it.`}
        </Empty>
      ) : (
        <ListingGrid listings={listings} now={now} me={address} info={info} />
      )}

      {view !== "completed" && (market.truncated || market.poolError) && (
        <p className="mt-4 text-xs text-muted">
          {market.truncated && `Showing the newest ${MARKET_SIZE} deals; browse Deals and search for ${symbol} to see the rest. `}
          {market.poolError ? "The signed-swap pool isn't answering, so signed swaps are missing." : null}
        </p>
      )}
    </section>
  );
}
