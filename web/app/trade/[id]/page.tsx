"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { StatusBadge, TradeSide } from "@/components/TradeParts";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useChogOwners } from "@/hooks/useChogs";
import { useLocalFills } from "@/hooks/useLocalFills";
import { useTrade } from "@/hooks/useTrade";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useNow } from "@/hooks/useNow";
import { displayStatus, sameAddress } from "@/lib/trades";
import { formatDate } from "@/lib/format";
import { swap } from "@/lib/contracts";

export default function TradeDetailPage() {
  const params = useParams<{ id: string }>();
  if (!/^\d+$/.test(params.id)) return <EmptyState>Invalid trade id.</EmptyState>;
  return <TradeDetail id={BigInt(params.id)} />;
}

function TradeDetail({ id }: { id: bigint }) {
  const { address } = useConnection();
  const { trade, isLoading, error } = useTrade(id);
  const now = useNow();
  const action = useTxFlow();
  const { isApproved, approveCall } = useChogApproval(address);
  const { owners } = useChogOwners(trade?.requestedIds ?? []);
  const { record } = useLocalFills(address);

  const ownsRequested = useMemo(
    () => !!address && (trade?.requestedIds ?? []).every((tokenId) => owners.get(tokenId)?.toLowerCase() === address.toLowerCase()),
    [address, owners, trade?.requestedIds],
  );

  if (isLoading) return <EmptyState>Loading trade…</EmptyState>;
  if (error || !trade) return <EmptyState>This trade does not exist.</EmptyState>;

  const status = displayStatus(trade, now);
  const maker = sameAddress(trade.maker, address);
  const canFill = status === "open" && !maker && (!trade.taker || sameAddress(trade.taker, address)) && ownsRequested;

  async function runFill() {
    const receipt = await action.run({ ...swap, functionName: "fillTrade", args: [id], value: trade!.requestedMon });
    if (receipt) record(id);
  }

  return (
    <>
      <PageHeader title={`Trade #${id.toString()}`}>
        <StatusBadge status={status} />
      </PageHeader>
      <div className="space-y-6">
        <div className="card grid gap-6 p-5 md:grid-cols-2">
          <div><div className="label">Maker gives</div><TradeSide ids={trade.offeredIds} mon={trade.offeredMon} /></div>
          <div><div className="label">Taker gives</div><TradeSide ids={trade.requestedIds} mon={trade.requestedMon} /></div>
          <div className="text-sm text-muted">Created by <span className="font-mono">{trade.maker}</span></div>
          <div className="text-sm text-muted">{trade.expiry === 0n ? "No expiry" : `Expires ${formatDate(trade.expiry)}`}</div>
        </div>
        <div className="card space-y-3 p-5">
          <div className="flex justify-between"><span>Maker</span><span className="text-mint">✓ deposited</span></div>
          <div className="flex justify-between"><span>Taker</span><span className="text-warn">✗ pays on accept</span></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {status === "open" && maker && <TxButton state={action.state} variant="danger" onClick={() => action.run({ ...swap, functionName: "cancelTrade", args: [id] })}>Cancel trade</TxButton>}
          {status === "expired" && <TxButton state={action.state} onClick={() => action.run({ ...swap, functionName: "reclaimExpired", args: [id] })}>Reclaim to maker</TxButton>}
          {canFill && !isApproved && <TxButton state={action.state} onClick={() => action.run(approveCall)}>Approve Chog Swap</TxButton>}
          {canFill && isApproved && <TxButton state={action.state} onClick={runFill}>Accept &amp; swap</TxButton>}
          {status === "open" && !maker && !canFill && <p className="text-sm text-muted">{trade.taker && !sameAddress(trade.taker, address) ? "This is a private offer for another wallet." : "You don’t own every requested Chog."}</p>}
          {status !== "open" && status !== "expired" && <p className="text-sm text-muted">This trade is settled and read-only.</p>}
          <Link href="/" className="btn-secondary">Back to trades</Link>
        </div>
        <TxStatus state={action.state} />
      </div>
    </>
  );
}
