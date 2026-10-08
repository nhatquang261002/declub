"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import type { Hex } from "viem";
import { useConnection, useReadContract } from "wagmi";
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
import { erc20Asset, feeUnits, formatAsset } from "@/lib/assets";
import { formatDate } from "@/lib/format";
import { isLive, nonceBit, reasonText, ringLegs, STATUS_HELP, STATUS_LABEL, type IntentStatus, type PoolIntent } from "@/lib/intents";
import { CopyAddress } from "@/components/CopyAddress";

export default function IntentPage() {
  const params = useParams<{ hash: string }>();
  if (!SHOW_INTENTS) return <EmptyState>Signed swaps aren&apos;t enabled on this deployment yet.</EmptyState>;
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.hash)) return <EmptyState>Invalid signed swap id.</EmptyState>;
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
        <LoadError title="Couldn't load this signed swap" error={error} />
      ) : isLoading ? (
        <EmptyState>Loading signed swap…</EmptyState>
      ) : !row ? (
        <EmptyState>The pool doesn&apos;t know this signed swap.</EmptyState>
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
  const settlement = useMemo(() => settlements.find((s) => s.txHash === row.settlementTx || s.cycle.some((r) => r.hash === row.hash)), [settlements, row]);
  const { info } = useIntentsTokenInfo(useMemo(() => [row, ...(settlement?.cycle ?? [])], [row, settlement]));
  // The fee charged is the contract's at settlement, which can be below what was signed (ADR 0018).
  const { fee: currentFee } = useIntentFee();
  const received = settlement ? ringLegs(settlement.cycle).find((l) => l.row.hash === row.hash)?.received : undefined;

  const why = mine && status === "stale" ? reasonText(row.reason) : null;
  // The fee is charged for each NFT the maker gives, at least once (ADR 0033); `maxFee` is per NFT.
  const units = feeUnits(intent.give);
  const feeText = (amount: bigint) => formatAsset(erc20Asset(intent.feeToken, amount * units), info.get(intent.feeToken.toLowerCase()));

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
                    value: currentFee && currentFee.amount < intent.maxFee ? feeText(currentFee.amount) : `Up to ${feeText(intent.maxFee)}`,
                    hint:
                      currentFee && currentFee.amount < intent.maxFee
                        ? `Signed for up to ${feeText(intent.maxFee)}. Maker pays, only if it settles`
                        : units > 1n
                          ? `${units.toString()} NFTs given, so the fee is paid ${units.toString()} times. Maker pays, only if it settles`
                          : "Maker pays, only if it settles",
                  },
                ]
              : []),
            {
              label: "Maker's wallet",
              value: (
                <span className="inline-flex flex-wrap items-baseline gap-x-2">
                  <CopyAddress address={intent.maker} full className="text-xs font-semibold" />
                  <a
                    href={explorerAddress(intent.maker)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs font-semibold"
                    title="View on the explorer"
                  >
                    ↗
                  </a>
                </span>
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
      {/* Removed from the pool but not yet expired: a copy that left the pool could still settle, so offer the real cancel. */}
      {mine && status === "cancelled" && intent.deadline >= BigInt(now) && swapIntents && (
        <DealDock tone="warn" eyebrow="Your signed swap" title="Removed from the pool">
          <p className="text-sm text-muted">
            This pool won&apos;t match it any more, but a copy of your signature that already left could still settle until {formatDate(intent.deadline)}.
          </p>
          <OnChainCancel maker={intent.maker} nonce={intent.nonce} />
        </DealDock>
      )}
      {!mine && live && (
        <DealDock tone="blocked" eyebrow="How this settles" title="A matcher settles this, not a button">
          <p className="text-sm text-muted">
            Signed swaps aren&apos;t accepted by hand. When a wallet&apos;s own signed swap fits this one, the matcher settles both in one transaction.
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
  const sign = useSignFlow();
  const { intent } = row;
  const { fee: currentFee } = useIntentFee();
  const readiness = useIntentReadiness(
    intent.maker,
    stale ? intent.give : [],
    info,
    "token",
    // The maker needs WMON for the fee that would be charged now, never more than they signed, per NFT they give.
    useMemo(
      () => ({
        token: intent.feeToken,
        amount: currentFee && currentFee.amount < intent.maxFee ? currentFee.amount : intent.maxFee,
      }),
      [intent.feeToken, intent.maxFee, currentFee],
    ),
  );
  const fix = readiness.steps[0];

  return (
    <DealDock tone={stale ? "warn" : "maker"} eyebrow="Your signed swap" title={stale ? "Your swap is on hold" : "Your swap is in the pool"}>
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
          Removing it from the pool is free (you sign a message), but it only stops this pool from using it. A copy of your signature that already left could
          still settle until the deadline.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <TxButton variant="secondary" state={sign.state} onClick={() => sign.cancel(row.hash)}>
            Remove from pool
          </TxButton>
        </div>
        <TxStatus state={sign.state} />
      </div>

      {swapIntents && (
        <div className="border-t-2 border-dashed border-[#111318]/15 pt-4">
          <OnChainCancel maker={intent.maker} nonce={intent.nonce} />
        </div>
      )}
    </DealDock>
  );
}

/**
 * `invalidateNonces` for one intent: the only cancel that holds against a copy of the signature that left the
 * pool. Reads the nonce first so a swap already cancelled on-chain says so instead of offering a second tx.
 */
function OnChainCancel({ maker, nonce }: { maker: `0x${string}`; nonce: bigint }) {
  const invalidate = useTxFlow();
  const used = useReadContract({
    ...swapIntents!,
    functionName: "isNonceUsed",
    args: [maker, nonce],
  });

  if (used.data) {
    return <p className="text-sm text-muted">Cancelled on-chain. This signature can never settle now.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        To be certain it can never settle, cancel it permanently on-chain. That costs gas. Revoking the approval in your wallet also stops the assets from
        moving.
      </p>
      <TxButton
        variant="danger"
        state={invalidate.state}
        onClick={() => {
          const { word, mask } = nonceBit(nonce);
          return invalidate.run({ ...swapIntents!, functionName: "invalidateNonces", args: [word, mask] });
        }}
      >
        Cancel on-chain
      </TxButton>
      <TxStatus state={invalidate.state} success="Cancelled on-chain. It can never settle now." />
    </div>
  );
}
