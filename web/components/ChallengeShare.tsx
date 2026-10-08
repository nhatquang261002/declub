"use client";

import { useState } from "react";
import { XLogoIcon } from "@/components/Icons";
import { SharePreviewDialog } from "@/components/SharePreviewDialog";
import { challengePageUrl, challengeShareUrl, viewerWin } from "@/lib/challengeShare";
import type { PublicChallenge } from "@/lib/challenges";

/**
 * "Share on X" for a Club challenge (ADR 0045): it opens a preview of the challenge's card first
 * (the podium once settled, the prize and the time left while open), and from there a compose link
 * posts it. A winner shares their win, an entrant their entry, anyone else the challenge or its
 * results. `nameOf` names winners in a results post (their X handle), when the caller knows them.
 */
export function ChallengeShare({
  c,
  token,
  club,
  wallet,
  nameOf,
  className = "",
}: {
  c: PublicChallenge;
  token: string;
  /** The Club's name: "Chog". */
  club: string;
  /** The viewer's wallet, if signed in. */
  wallet?: string;
  nameOf?: (wallet: string) => string | undefined;
  className?: string;
}) {
  // The page's own origin: known in the browser, empty while rendering on the server.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [open, setOpen] = useState(false);
  if (c.phase === "cancelled") return null;

  const viewerWallets = wallet ? [wallet] : [];
  const won = c.phase === "settled" && !!viewerWin(c, viewerWallets);
  const label = won ? "Share your win" : c.phase === "open" && c.mine ? "Share your entry" : "Share on X";
  const href = challengeShareUrl(c, { token, club, viewerWallets, nameOf, origin: origin || undefined });
  const imageUrl = `${challengePageUrl(token, c.id, origin || undefined)}/opengraph-image`;
  return (
    <>
      <button type="button" className={`btn-secondary inline-flex items-center gap-2 ${className}`} onClick={() => setOpen(true)}>
        <XLogoIcon className="size-3.5" />
        {label}
      </button>
      {open && <SharePreviewDialog imageUrl={imageUrl} shareUrl={href} title={won ? "Share your win" : "Share the challenge"} onClose={() => setOpen(false)} />}
    </>
  );
}
