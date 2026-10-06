"use client";

import type { Address } from "viem";
import { TxButton, TxStatus } from "@/components/Tx";
import { useClubStandings, useMyRewards } from "@/hooks/useRewards";
import { useTxFlow } from "@/hooks/useTxFlow";
import { clubRewards } from "@/lib/contracts";
import { formatMon } from "@/lib/format";

/**
 * What `account` has earned in Club Rewards, and one button to claim everything that's open.
 * Anyone may send the claim: the MON always goes to `account`, so a member can claim for their
 * Club wallet from whichever wallet is connected.
 */
export function RewardsClaim({ account, club }: { account: Address | undefined; club?: string }) {
  const mine = useMyRewards(account);
  const tx = useTxFlow();
  const live = useClubStandings(club ?? "", account, !!club && !!account);

  if (!account) return <p className="text-sm text-muted">Join a Club with a wallet linked to see what it earns you.</p>;
  if (mine.isLoading) return <p className="text-sm text-muted">Checking your rewards…</p>;
  if (!mine.enabled) return <p className="text-sm text-muted">Rewards aren’t running on this server yet.</p>;

  // On a Club's page, show what this Club paid; the button still claims everything at once.
  const here = club
    ? mine.leaves.reduce((sum, leaf) => sum + leaf.breakdown.filter((b) => b.club === club.toLowerCase()).reduce((s, b) => s + BigInt(b.amount), 0n), 0n)
    : null;
  // The running epoch isn't a leaf yet, so add what the live standings say it would pay if it closed now.
  const me = live.standings?.me;
  const running = me && "estimate" in me && me.estimate ? BigInt(me.estimate) : 0n;
  const claim = () =>
    tx.run({
      ...clubRewards!,
      functionName: "claimMany",
      args: [mine.claimable.map((leaf) => ({ epoch: BigInt(leaf.epoch), account: leaf.account, amount: BigInt(leaf.amount), proof: leaf.proof }))],
    });

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="kicker">Ready to claim</dt>
          <dd className="mt-1 text-lg font-black tabular-nums">{formatMon(mine.totals.claimable)}</dd>
        </div>
        <div>
          <dt className="kicker">On its way</dt>
          <dd className="mt-1 text-lg font-black tabular-nums">{formatMon(mine.totals.waiting + running)}</dd>
          {running > 0n && <p className="mt-0.5 text-xs text-muted">{formatMon(running)} is this epoch’s estimate</p>}
        </div>
        <div>
          <dt className="kicker">{here === null ? "Claimed" : "Earned here"}</dt>
          <dd className="mt-1 text-lg font-black tabular-nums">{formatMon(here ?? mine.totals.claimed)}</dd>
        </div>
      </dl>
      {mine.configured ? (
        <div className="flex flex-wrap items-center gap-3">
          <TxButton state={tx.state} disabled={mine.claimable.length === 0} onClick={claim}>
            {mine.claimable.length > 1 ? `Claim ${mine.claimable.length} epochs` : "Claim"}
          </TxButton>
          {mine.claimable.length === 0 && mine.totals.waiting + running > 0n && (
            <p className="text-xs text-muted">Rewards open once an epoch closes, is published and its review day has passed.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">Claiming isn’t set up on this app yet (no rewards contract).</p>
      )}
      <TxStatus state={tx.state} success="Claimed. The MON is in your wallet." />
    </div>
  );
}
