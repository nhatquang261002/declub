"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import type { Hex } from "viem";
import { useConnection } from "wagmi";
import { AssetList } from "@/components/AssetList";
import { SettlementTag } from "@/components/DealParts";
import { BackToDeals, DealByline, DealDock, DealFacts, DealSheet, DealSheetHead, DealStage, DealStageSide, DealStamp, DealTitle } from "@/components/DealSheet";
import { ConsentNotice, CycleView, INTENT_STAMP, useIntentsTokenInfo } from "@/components/IntentParts";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState } from "@/components/Page";
import { TxButton, TxStatus } from "@/components/Tx";
import { useIntent, useSettlements } from "@/hooks/usePool";
import { useIntentReadiness } from "@/hooks/useIntentReadiness";
import { useNow } from "@/hooks/useNow";
import { useIntentFee } from "@/hooks/useProtocolFee";
import { useSignFlow } from "@/hooks/useSignFlow";
import { useTxFlow } from "@/hooks/useTxFlow";
import { explorerAddress, SHOW_INTENTS } from "@/lib/config";
import { swapIntents } from "@/lib/contracts";
import { sameAddress } from "@/lib/deals";
import { erc20Asset, formatAsset } from "@/lib/assets";
import { formatDate } from "@/lib/format";
import {
  isLive,
  nonceBit,
  reasonText,
  ringLegs,
  STATUS_HELP,
  STATUS_LABEL,
  type IntentStatus,
  type PoolIntent,
} from "@/lib/intents";

export default function IntentPage() {
  const params = useParams<{ hash: string }>();
  if (!SHOW_INTENTS) return <EmptyState>Intents aren&apos;t enabled on this deployment yet.</EmptyState>;
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.hash)) return <EmptyState>Invalid intent id.</EmptyState>;
  return <IntentDetail hash={params.hash as Hex} />;
}

function IntentDetail({ hash }: { hash: Hex }) {
  const { address } = useConnection();
  const now = useNow();
  const { row, isLoading, error } = useIntent(hash);

  return (
    <>
      <BackToDeals />
      {error ? (
        <LoadError title="Couldn&apos;t load this intent" error={error} />
      ) : isLoading ? (
        <EmptyState>Loading intent…</EmptyState>
      ) : !row ? (
        <EmptyState>The pool doesn&apos;t know this intent.</EmptyState>
      ) : (
        <Body row={row} me={address} now={now} />
      )}
    </>
  );
}

function Body({ row, me, now }: { row: PoolIntent; me?: `0x${string}`; now: number }) {
  const { intent } = row;
  const mine = sameAddress(intent.maker, me);
  // Past its deadline a live intent can't settle, whatever the pool last said.
  const status: IntentStatus = isLive(row.status) && intent.deadline < BigInt(now) ? "expired" : row.status;
  const live = isLive(status);

  // The cycle this intent settled in, from the pool's settlements for its maker.
  const { settlements } = useSettlements({ maker: intent.maker, enabled: status === "settled" });
  const settlement = useMemo(
    () => settlements.find((s) => s.txHash === row.settlementTx || s.cycle.some((r) => r.hash === row.hash)),
    [settlements, row],
  );
  const { info } = useIntentsTokenInfo(useMemo(() => [row, ...(settlement?.cycle ?? [])], [row, settlement]));
  // The fee charged is the contract's at settlement, which can be below what was signed (ADR 0018).
  const { fee: currentFee } = useIntentFee();
  const received = settlement ? ringLegs(settlement.cycle).find((l) => l.row.hash === row.hash)?.received : undefined;

  const why = mine && status === "stale" ? reasonText(row.reason) : null;
  const feeText = (amount: bigint) => formatAsset(erc20Asset(intent.feeToken, amount), info.get(intent.feeToken.toLowerCase()));

  return (
    <div className="space-y-8">
      <DealSheet>
        <DealSheetHead
          chips={
            <>
              <SettlementTag signed />
              {mine && <span className="chip chip-dark">Your swap</span>}
            </>
          }
          title={<DealTitle prefix="Swap" id={<span className="font-mono text-[0.7em] tracking-tight">{row.hash.slice(2, 10)}</span>} />}
          byline={
            <div className="space-y-1">
              <DealByline verb="signed by" maker={intent.maker} mine={mine} expiry={intent.deadline} now={now} live={live} />
              <p className="max-w-xl">{STATUS_HELP[status]}</p>
              {why && <p className="font-semibold text-warn">{why}</p>}
              {row.reason && status === "rejected" && <p>{reasonText(row.reason)}</p>}
            </div>
          }
          stamp={<DealStamp status={INTENT_STAMP[status]} label={STATUS_LABEL[status]} />}
        />

        <DealStage
          status={INTENT_STAMP[status]}
          live={live}
          gives={
            <DealStageSide side="give" title={mine ? "You give" : "Maker gives"} note={live ? "Stays in wallet" : undefined}>
              <AssetList assets={intent.give} info={info} />
            </DealStageSide>
          }
          wants={
            <DealStageSide side="want" title={mine ? "You get, at least" : "Wants, at least"} mine={mine}>
              <AssetList assets={intent.want} info={info} />
              <p className="text-xs text-muted">Token amounts are a minimum, and the maker keeps any extra. NFTs are exact.</p>
            </DealStageSide>
          }
        />

        <DealFacts
          facts={[
            { label: "Deadline", value: formatDate(intent.deadline) },
            ...(intent.maxFee > 0n
              ? [
                  {
                    label: "Protocol fee",
                    value:
                      currentFee && currentFee.amount < intent.maxFee
                        ? feeText(currentFee.amount)
                        : `Up to ${feeText(intent.maxFee)}`,
                    hint:
                      currentFee && currentFee.amount < intent.maxFee
                        ? `Signed for up to ${feeText(intent.maxFee)}. Maker pays, only if it settles`
                        : "Maker pays, only if it settles",
                  },
                ]
              : []),
            {
              label: "Maker's wallet",
              value: (
                <a href={explorerAddress(intent.maker)} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold">
                  {intent.maker} ↗
                </a>
              ),
            },
            { label: "Nonce", value: <span className="font-mono">{intent.nonce.toString()}</span> },
          ]}
        />
      </DealSheet>

      {status === "settled" && settlement && (
        <>
          <CycleView settlement={settlement} me={me} info={info} />
          {mine && received && (
            <section className="deal-panel space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip chip-mint">Delivered</span>
                <h2 className="font-black">You received</h2>
              </div>
              <AssetList assets={received} info={info} />
            </section>
          )}
        </>
      )}

      {mine && live && <MakerPanel row={row} info={info} stale={status === "stale"} />}
      {!mine && live && (
        <DealDock tone="blocked" eyebrow="How this settles" title="A matcher settles this, not a button">
          <p className="text-sm text-muted">
            Signed swaps aren&apos;t accepted by hand. When a wallet&apos;s own signed swap fits this one, the matcher settles
            both in one transaction.
          </p>
          <ConsentNotice />
        </DealDock>
      )}
    </div>
  );
}

/** What the maker can do with a live intent: put it back in play, take it out of the pool, or kill it on-chain. */
function MakerPanel({ row, info, stale }: { row: PoolIntent; info: ReturnType<typeof useIntentsTokenInfo>["info"]; stale: boolean }) {
  const approval = useTxFlow();
  const invalidate = useTxFlow();
  const sign = useSignFlow();
  const { intent } = row;
  const { fee: currentFee } = useIntentFee();
  const readiness = useIntentReadiness(
    intent.maker,
    stale ? intent.give : [],
    info,
    "token",
    // The maker needs WMON for the fee that would be charged now, never more than they signed.
    useMemo(
      () => ({
        token: intent.feeToken,
        amount: currentFee && currentFee.amount < intent.maxFee ? currentFee.amount : intent.maxFee,
      }),
      [intent.feeToken, intent.maxFee, currentFee],
    ),
  );
  const fix = readiness.steps[0];
  const contract = swapIntents;

  return (
    <DealDock tone={stale ? "warn" : "maker"} eyebrow="Your intent" title={stale ? "Your swap is on hold" : "Your swap is in the pool"}>

      {stale && (
        <div className="space-y-2">
          {readiness.problems.length > 0 && <p className="text-sm text-warn">{readiness.problems[0]}</p>}
          {fix && (
            <>
              <p className="text-sm text-muted">Approve it again to put it back in play. The matcher rechecks about every 30 seconds.</p>
              <TxButton state={approval.state} onClick={() => approval.run(fix.call)}>
                {fix.label}
              </TxButton>
              <TxStatus state={approval.state} success="Approved." />
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm text-muted">
          Removing it from the pool is free (you sign a message), but it only stops this pool from using it. A copy of
          your signature that already left could still settle until the deadline.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <TxButton variant="secondary" state={sign.state} onClick={() => sign.cancel(row.hash)}>
            Remove from pool
          </TxButton>
        </div>
        <TxStatus state={sign.state} />
      </div>

      {contract && (
        <div className="space-y-2 border-t-2 border-dashed border-[#111318]/15 pt-4">
          <p className="text-sm text-muted">
            To be certain it can never settle, burn its nonce on-chain. That costs gas. Revoking the approval in your
            wallet also stops the assets from moving.
          </p>
          <TxButton
            variant="danger"
            state={invalidate.state}
            onClick={() => {
              const { word, mask } = nonceBit(intent.nonce);
              return invalidate.run({ ...contract, functionName: "invalidateNonces", args: [word, mask] });
            }}
          >
            Cancel on-chain
          </TxButton>
          <TxStatus state={invalidate.state} success="Cancelled on-chain. It can never settle now." />
        </div>
      )}
    </DealDock>
  );
}
