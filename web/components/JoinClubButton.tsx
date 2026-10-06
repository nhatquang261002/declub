"use client";

import { ActionMenu } from "@/components/ActionMenu";
import { HolderBadge } from "@/components/HolderBadge";
import { Spinner } from "@/components/Spinner";
import { CheckIcon, SignOutIcon } from "@/components/Icons";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useSignIn } from "@/hooks/useSignIn";

/**
 * Join or leave a Club. Joining shows your wallet on the Members list, so it says so under the
 * button. Signed out it offers sign-in; without sign-in or a server that keeps memberships it says
 * nothing: the Club is simply readable. Leaving sits behind the "⋯" menu, where it can't be hit by
 * accident.
 */
export function JoinClubButton({
  token,
  symbol,
  archived,
  hint = true,
}: {
  token: string;
  symbol: string;
  archived: boolean;
  /** The line under the button; off where the text around it already explains. */
  hint?: boolean;
}) {
  const signIn = useSignIn();
  const m = useClubMembership(token);

  if (signIn) {
    return (
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <button type="button" className="btn-primary" onClick={signIn}>
          Sign in to join
        </button>
        {hint && <p className="text-xs text-muted">Members can post on the Board.</p>}
      </div>
    );
  }
  if (!m.signedIn || !m.enabled) return null;
  if (m.isLoading) {
    return (
      <button type="button" className="btn-secondary" disabled>
        Checking…
      </button>
    );
  }

  if (m.member) {
    return (
      <div className="flex items-center gap-2">
        {m.holder && <HolderBadge symbol={symbol} />}
        <span className="chip chip-peach py-1 text-xs">
          <CheckIcon />
          Member
        </span>
        <ActionMenu
          label="Membership"
          groups={[
            [
              {
                label: m.pending ? "Leaving…" : "Leave this Club",
                icon: <SignOutIcon />,
                danger: true,
                confirm: "Leave this Club?",
                confirmNote: "Your wallet comes off the Members list. You can join again later.",
                onSelect: m.leave,
              },
            ],
          ]}
        />
      </div>
    );
  }
  if (archived) return <span className="chip">Not taking new members</span>;
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button type="button" className="btn-primary px-6" aria-busy={m.pending} disabled={m.pending} onClick={m.join}>
        {m.pending && <Spinner />}
        {m.pending ? "Joining…" : "Join Club"}
      </button>
      {hint && <p className="text-xs text-muted">Shows your wallet on the Members list.</p>}
    </div>
  );
}
