"use client";

import { Spinner } from "@/components/Spinner";
import { useFollows } from "@/hooks/useSocial";

/**
 * Follow or unfollow a wallet (ADR 0023). Your wallet signs it, so the follow is yours: anyone can
 * read and check it at /api/wallets/<you>/follows. Shows nothing when following isn't possible
 * (signed out, no wallet connected) or for your own wallet.
 */
export function FollowButton({ target, follows }: { target: string; follows: ReturnType<typeof useFollows> }) {
  if (!follows.can || !follows.me || follows.me.toLowerCase() === target.toLowerCase()) return null;
  const on = follows.following.has(target.toLowerCase());
  const busy = follows.pending === target.toLowerCase();
  return (
    <button
      type="button"
      className={`chip px-2 py-0.5 text-[0.7rem] ${on ? "chip-dark" : "hover:bg-white"}`}
      aria-pressed={on}
      aria-busy={busy}
      disabled={busy}
      onClick={() => follows.toggle(target)}
    >
      {busy && <Spinner />}
      {busy ? (follows.stage === "sending" ? "Saving…" : "Confirm in wallet…") : on ? "Following" : "Follow"}
    </button>
  );
}
