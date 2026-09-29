"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useConnection } from "wagmi";
import { EmptyState, PageHeader } from "@/components/Page";
import { StatusBadge, TradeSide } from "@/components/TradeParts";
import { TraitRequestSummary } from "@/components/TraitRequest";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useChogOwners, useOwnedChogMetadata } from "@/hooks/useChogs";
import { useLocalFills } from "@/hooks/useLocalFills";
import { useTrade } from "@/hooks/useTrade";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useNow } from "@/hooks/useNow";
import { displayStatus, sameAddress } from "@/lib/trades";
import { formatDate } from "@/lib/format";
import { chog, swap } from "@/lib/contracts";
import { buildMerkleSet } from "@/lib/merkle";

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
  const { entries: ownedEntries } = useOwnedChogMetadata(address);
  const { record } = useLocalFills(address);
  const [traitType, setTraitType] = useState("");
  const [traitValue, setTraitValue] = useState("");

  const ownsRequested = useMemo(
    () => !!address && (trade?.requestedIds ?? []).every((tokenId) => owners.get(tokenId)?.toLowerCase() === address.toLowerCase()),
    [address, owners, trade?.requestedIds],
  );
  const traitOptions = useMemo(() => {
    const options = new Map<string, Set<string>>();
    ownedEntries.forEach(({ metadata }) => metadata.attributes.forEach(({ trait_type, value }) => {
      if (!options.has(trait_type)) options.set(trait_type, new Set());
      options.get(trait_type)!.add(value);
    }));
    return [...options.entries()].flatMap(([type, values]) =>
      [...values].map((value) => ({ type, value })),
    );
  }, [ownedEntries]);
  const selectedTraitIds = useMemo(
    () => ownedEntries
      .filter(({ metadata }) => metadata.attributes.some(
        (attribute) => attribute.trait_type === traitType && attribute.value === traitValue,
      ))
      .map(({ id }) => id),
    [ownedEntries, traitType, traitValue],
  );
  const traitSet = useMemo(
    () => buildMerkleSet(selectedTraitIds, chog.address),
    [selectedTraitIds],
  );
  const traitReady = !!trade?.requestedRoot
    && trade.requestedCount === BigInt(selectedTraitIds.length)
    && traitSet.root.toLowerCase() === trade.requestedRoot.toLowerCase();
  const isTraitTrade = !!trade?.requestedRoot && !!trade.requestedCount && trade.requestedCount > 0n;

  if (isLoading) return <EmptyState>Loading trade…</EmptyState>;
  if (error || !trade) return <EmptyState>This trade does not exist.</EmptyState>;

  const status = displayStatus(trade, now);
  const maker = sameAddress(trade.maker, address);
  const canFill = status === "open" && !maker && (!trade.taker || sameAddress(trade.taker, address))
    && (isTraitTrade ? traitReady : ownsRequested);

  async function runFill() {
    const receipt = isTraitTrade
      ? await action.run({
        ...swap,
        functionName: "fillTrade",
        args: [id, selectedTraitIds, selectedTraitIds.map((tokenId) => traitSet.proofs.get(tokenId) ?? [])],
        value: trade!.requestedMon,
      })
      : await action.run({ ...swap, functionName: "fillTrade", args: [id], value: trade!.requestedMon });
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
          <div>
            <div className="label">Taker gives</div>
            {trade.requestedRoot && trade.requestedCount && trade.requestedCount > 0n
              ? <div className="space-y-3">
                <TraitRequestSummary count={trade.requestedCount} root={trade.requestedRoot} />
                <label className="block text-sm">
                  <span className="label">Trait</span>
                  <select className="input w-full" value={`${traitType}:${traitValue}`} onChange={(event) => {
                    const [type, ...value] = event.target.value.split(":");
                    setTraitType(type);
                    setTraitValue(value.join(":"));
                  }}>
                    <option value=":">Select a trait from your Chogs</option>
                    {traitOptions.map((option) => (
                      <option key={`${option.type}:${option.value}`} value={`${option.type}:${option.value}`}>
                        {option.type}: {option.value}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-muted">
                  Matching owned Chogs: {selectedTraitIds.length}. Select the trait committed by the maker.
                </p>
                {traitType && !traitReady && <p className="text-xs text-warn">This selection does not match the maker’s committed set.</p>}
              </div>
              : <TradeSide ids={trade.requestedIds} mon={trade.requestedMon} />}
          </div>
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
          {canFill && !isApproved && <TxButton state={action.state} onClick={() => action.run(approveCall)}>Approve On Deal</TxButton>}
          {canFill && isApproved && (!trade.requestedRoot || traitReady) && <TxButton state={action.state} onClick={runFill}>Accept &amp; swap</TxButton>}
          {status === "open" && !maker && !canFill && <p className="text-sm text-muted">{isTraitTrade ? "Select the maker’s committed trait and matching Chogs to accept this trade." : trade.taker && !sameAddress(trade.taker, address) ? "This is a private offer for another wallet." : "You don’t own every requested Chog."}</p>}
          {status !== "open" && status !== "expired" && <p className="text-sm text-muted">This trade is settled and read-only.</p>}
          <Link href="/" className="btn-secondary">Back to trades</Link>
        </div>
        <TxStatus state={action.state} />
      </div>
    </>
  );
}
