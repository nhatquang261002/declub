"use client";

import { useState } from "react";
import { SharePreviewDialog } from "@/components/SharePreviewDialog";
import { XLogoIcon } from "@/components/Icons";
import type { Asset, TokenInfo } from "@/lib/assets";
import { displayStatus } from "@/lib/deals";
import { dealPostLink, describeAssets, type DealFacts } from "@/lib/dealShare";
import { isOpenOffer, type DealV2 } from "@/lib/dealsV2";
import { registry } from "@/lib/verifiedAssets";

/** The Club of the first asset in the deal that has one, so the post is about the Club too. */
const clubOf = (assets: readonly Asset[]) => assets.map((a) => registry.clubFor(a.token)).find((c) => c !== null) ?? null;

/**
 * "Share on X": a compose link for a live offer or a swap that went through. The link goes to the
 * deal's page, whose preview card (opengraph-image) shows the offer. A post that links the Club also
 * counts as about it ([ADR 0024](docs/adr/0024-x-posts-and-the-holder-bonus.md)) once it's on the Board.
 */
export function ShareDeal({ deal, info, now }: { deal: DealV2; info: ReadonlyMap<string, TokenInfo>; now: number }) {
  // The page's own origin: known in the browser, empty while rendering on the server.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [open, setOpen] = useState(false);
  const status = displayStatus(deal, now);
  if (status !== "open" && status !== "filled") return null;

  const nameOf = (token: string) => registry.entry(token)?.name;
  const facts: DealFacts = {
    id: deal.id.toString(),
    status,
    give: describeAssets(deal.offered, info, nameOf),
    want: describeAssets(deal.requested, info, nameOf),
    openOffer: isOpenOffer(deal),
  };
  const club = clubOf([...deal.offered, ...deal.requested]);
  const dealUrl = `${origin}/v2/deal/${facts.id}`;
  const imageUrl = `${dealUrl}/opengraph-image`;
  const href = dealPostLink(facts, dealUrl, club?.name);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setOpen(true)}>
        <XLogoIcon className="size-3.5" />
        {status === "filled" ? "Share the swap on X" : "Share on X"}
      </button>
      {club && (
        <span className="text-xs text-muted">
          Then paste the post on the {club.symbol} Club’s Board: your own post about the Club counts toward your Holder bonus.
        </span>
      )}
      {open && <SharePreviewDialog imageUrl={imageUrl} shareUrl={href} title={status === "filled" ? "Share the swap" : "Share the deal"} onClose={() => setOpen(false)} />}
    </div>
  );
}
