"use client";

import type { Address } from "viem";
import { LoadError } from "@/components/ErrorPanel";
import { CrownIcon } from "@/components/Icons";
import { RewardsClaim } from "@/components/RewardsClaim";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubRewards } from "@/hooks/useRewards";
import { formatMon, untilLabel } from "@/lib/format";
import { REWARDS, percent } from "@/lib/rewards";
import { Empty, Loading, Panel } from "./parts";

const wei = (s: string | undefined) => BigInt(s ?? "0");

/**
 * The Rewards tab: how a Club's market pays its Holders and its Owner (ADR 0022). Every completed
 * swap in the Club pays the protocol fee; each epoch, part of it comes back here.
 */
export function ClubRewards({ token, symbol, wallet, isOwner, now }: { token: string; symbol: string; wallet?: string; isOwner: boolean; now: number }) {
  const { data, isLoading, error } = useClubRewards(token);

  if (isLoading) return <Loading label="Loading rewards" rows={3} />;
  if (error) return <LoadError title="Couldn’t load rewards" error={error} />;

  const latest = data?.epochs[0];
  const rolling = wei(data?.carry.holders) + wei(data?.carry.fund);

  return (
    <div className="flex flex-col gap-5">
      <Panel title="How this Club earns">
        <p className="text-sm">
          Every completed swap of {symbol} pays a small protocol fee. Each epoch,{" "}
          <strong>{percent(REWARDS.holderBps)}</strong> of it goes to the Club’s Holders, split by the NFTs they hold, and{" "}
          <strong>{percent(REWARDS.fundBps)}</strong> to the Club fund, which the Owner claims. You earn as a member who holds {symbol}{" "}
          when the epoch closes: one share per NFT. A Club’s memecoin can make you a Holder, if the Owner allows it, but earns no share.
        </p>
        <p className="mt-2 text-sm">
          Active Holders earn more: your shares count up to <strong>{percent(REWARDS.maxBonusBps)} more</strong> for what you did in the Club that
          epoch: trading here, and sharing your own X posts about the Club on its Board (one a day counts).{" "}
          {data?.xReach
            ? "Posts that people liked, reposted, quoted or replied to count for more."
            : "Each counted post adds the same, however it did on X."}
        </p>
        {data && data.epoch >= 0 && (
          <p className="mt-3 text-xs text-muted">
            Epoch {data.epoch} closes {untilLabel(data.endsAt, now)}. Rewards are paid in MON.
          </p>
        )}
      </Panel>

      <Panel title={wallet ? "Your share" : "Your share (join to earn)"}>
        <RewardsClaim account={wallet as Address | undefined} club={token} />
        {isOwner && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <CrownIcon className="size-3.5" />
            As the Owner, the Club fund is paid to this wallet with your share.
          </p>
        )}
      </Panel>

      {!data?.enabled || data.epochs.length === 0 ? (
        <Empty title="No epoch paid out yet">
          The first rewards land when an epoch closes after swaps in {symbol}.
          {rolling > 0n && ` ${formatMon(rolling)} is already waiting to roll in.`}
        </Empty>
      ) : (
        <>
          <Panel title={`Epoch ${latest!.n}`}>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Figure label="Fees from swaps" value={formatMon(wei(latest!.fees))} />
              <Figure label="To Holders" value={formatMon(wei(latest!.paidHolders))} hint={`${latest!.holderCount} ${latest!.holderCount === 1 ? "Holder" : "Holders"}`} />
              <Figure label="Club fund" value={formatMon(wei(latest!.paidFund))} />
              <Figure label="Rolls over" value={formatMon(rolling)} hint="No Holders or no Owner yet, plus rounding" />
            </dl>
          </Panel>

          {data.earners.length > 0 && (
            <Panel title="Who earned">
              <ul className="divide-y divide-[#111318]/10">
                {data.earners.map((e) => (
                  <li key={`${e.account}-${e.kind}`} className="flex items-center gap-3 py-2.5">
                    <WalletAvatar seed={e.account} />
                    <span className="min-w-0 flex-1">
                      <Who address={e.account} />
                    </span>
                    {e.kind === "holder" && e.bonusBps !== undefined && e.bonusBps > 0 && <span className="chip chip-peach">+{percent(e.bonusBps)} active</span>}
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
      )}

      <p className="text-xs text-muted">
        Rewards say this market has been busy, not that the asset is safe. Each epoch’s numbers and proofs are public at{" "}
        <span className="font-mono">/api/rewards/epochs/&lt;n&gt;</span>, so anyone can check the payouts.
      </p>
    </div>
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
