"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import type { Hex } from "viem";
import { useConnection } from "wagmi";
import { AssetList } from "@/components/AssetList";
import { ExpiryCountdown } from "@/components/DealParts";
import { ConsentNotice, CycleView, IntentStatusBadge, useIntentsTokenInfo } from "@/components/IntentParts";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState, PageHeader } from "@/components/Page";
import { TxButton, TxStatus } from "@/components/Tx";
import { useIntent, useSettlements } from "@/hooks/usePool";
import { useIntentReadiness } from "@/hooks/useIntentReadiness";
import { useNow } from "@/hooks/useNow";
import { useSignFlow } from "@/hooks/useSignFlow";
import { useTxFlow } from "@/hooks/useTxFlow";
import { explorerAddress } from "@/lib/config";
import { swapIntents } from "@/lib/contracts";
import { sameAddress } from "@/lib/deals";
import { Who } from "@/components/Who";
import { formatDate } from "@/lib/format";
import {
  isLive,
  nonceBit,
  reasonText,
  ringLegs,
  STATUS_HELP,
  type IntentStatus,
  type PoolIntent,
} from "@/lib/intents";

export default function IntentPage() {
  const params = useParams<{ hash: string }>();
  if (!swapIntents) return <EmptyState>Intents aren&apos;t enabled on this deployment yet.</EmptyState>;
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.hash)) return <EmptyState>Invalid intent id.</EmptyState>;
  return <IntentDetail hash={params.hash as Hex} />;
}

function IntentDetail({ hash }: { hash: Hex }) {
  const { address } = useConnection();
  const now = useNow();
  const { row, isLoading, error } = useIntent(hash);

  return (
    <>
      <PageHeader title="Signed swap">
        <Link href="/deals" className="btn-secondary">
          Back to deals
        </Link>
      </PageHeader>
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
  const received = settlement ? ringLegs(settlement.cycle).find((l) => l.row.hash === row.hash)?.received : undefined;

  const why = mine && status === "stale" ? reasonText(row.reason) : null;

  return (
    <div className="space-y-6">
      <section className="page-section space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <IntentStatusBadge status={status} />
          <span className="font-mono text-sm text-muted">{row.hash.slice(0, 10)}…{row.hash.slice(-6)}</span>
          <span className="ml-auto">
            <ExpiryCountdown expiry={intent.deadline} now={now} status={live ? "open" : status === "expired" ? "expired" : "filled"} />
          </span>
        </div>
        <p className="text-sm text-muted">{STATUS_HELP[status]}</p>
        {why && <p className="text-sm text-warn">{why}</p>}
        {row.reason && status === "rejected" && <p className="text-sm text-muted">{reasonText(row.reason)}</p>}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="page-section space-y-3 p-4">
          <h2 className="label !mb-0">Gives</h2>
          <AssetList assets={intent.give} info={info} />
        </section>
        <section className="page-section space-y-3 p-4">
          <h2 className="label !mb-0">Wants, at least</h2>
          <AssetList assets={intent.want} info={info} />
          <p className="text-xs text-muted">Token amounts are a minimum, and the maker keeps any extra. NFTs are exact.</p>
        </section>
      </div>

      <section className="page-section p-4">
        <dl className="space-y-1.5 text-sm">
          <Row label="Maker">
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              <Who address={intent.maker} mine={mine} />
              <a href={explorerAddress(intent.maker)} target="_blank" rel="noreferrer" className="text-xs underline">
                explorer ↗
              </a>
            </span>
          </Row>
          <Row label="Deadline">{formatDate(intent.deadline)}</Row>
          <Row label="Nonce">{intent.nonce.toString()}</Row>
        </dl>
      </section>

      {status === "settled" && settlement && (
        <>
          <CycleView settlement={settlement} me={me} info={info} />
          {mine && received && (
            <section className="page-section space-y-3 p-4">
              <h2 className="label !mb-0">You received</h2>
              <AssetList assets={received} info={info} />
            </section>
          )}
        </>
      )}

      {mine && live && <MakerPanel row={row} info={info} stale={status === "stale"} />}
      {!mine && live && <ConsentNotice />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

/** What the maker can do with a live intent: put it back in play, take it out of the pool, or kill it on-chain. */
function MakerPanel({ row, info, stale }: { row: PoolIntent; info: ReturnType<typeof useIntentsTokenInfo>["info"]; stale: boolean }) {
  const approval = useTxFlow();
  const invalidate = useTxFlow();
  const sign = useSignFlow();
  const { intent } = row;
  const readiness = useIntentReadiness(intent.maker, stale ? intent.give : [], info);
  const fix = readiness.steps[0];
  const contract = swapIntents;

  return (
    <section className="page-section space-y-4 p-4">
      <h2 className="label !mb-0">Your intent</h2>

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
        <div className="space-y-2 border-t border-white/10 pt-4">
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
    </section>
  );
}
