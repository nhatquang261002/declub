"use client";

import { HolderBadge } from "@/components/HolderBadge";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useSignIn } from "@/hooks/useSignIn";

/**
 * Join or leave a Club. Joining shows your wallet on the Members list, so it says so beside the
 * button. Signed out it offers sign-in; without sign-in or a server that keeps memberships it says
 * nothing: the Club is simply readable.
 */
export function JoinClubButton({ token, symbol, archived }: { token: string; symbol: string; archived: boolean }) {
  const signIn = useSignIn();
  const m = useClubMembership(token);

  if (signIn) {
    return (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <button type="button" className="btn-primary" onClick={signIn}>
          Sign in to join
        </button>
      </div>
    );
  }
  if (!m.signedIn || !m.enabled) return null;
  if (m.isLoading) return <button type="button" className="btn-secondary" disabled>…</button>;

  if (m.member) {
    return (
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <div className="flex items-center gap-2">
          {m.holder && <HolderBadge symbol={symbol} />}
          <span className="text-sm text-muted">You’re a member</span>
        </div>
        <button type="button" className="btn-secondary" disabled={m.pending} onClick={m.leave}>
          {m.pending ? "Leaving…" : "Leave"}
        </button>
      </div>
    );
  }
  if (archived) return <span className="text-sm text-muted">Not taking new members</span>;
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button type="button" className="btn-primary" disabled={m.pending} onClick={m.join}>
        {m.pending ? "Joining…" : "Join"}
      </button>
      <p className="max-w-56 text-xs text-muted sm:text-right">Joining shows your wallet on the Members list.</p>
    </div>
  );
}
