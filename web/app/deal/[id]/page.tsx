"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useConnection } from "wagmi";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState, PageHeader } from "@/components/Page";
import { describeError } from "@/lib/errors";
import { StatusBadge, DealSide } from "@/components/DealParts";
import { TraitRequestSummary } from "@/components/TraitRequest";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useChogOwners, useOwnedChogMetadata } from "@/hooks/useChogs";
import { useLocalFills } from "@/hooks/useLocalFills";
import { useDeal } from "@/hooks/useDeal";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useNow } from "@/hooks/useNow";
import { displayStatus, sameAddress } from "@/lib/deals";
import { Select } from "@/components/Select";
import { formatDate } from "@/lib/format";
import { chog, swap } from "@/lib/contracts";
import { buildMerkleSet } from "@/lib/merkle";

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  if (!/^\d+$/.test(params.id)) return <EmptyState>Invalid deal id.</EmptyState>;
  return <DealDetail id={BigInt(params.id)} />;
}

function DealDetail({ id }: { id: bigint }) {
  const { address } = useConnection();
  const { deal, isLoading, error } = useDeal(id);
  const now = useNow();
  const action = useTxFlow();
  const { isApproved, approveCall } = useChogApproval(address);
  const { owners } = useChogOwners(deal?.requestedIds ?? []);
  const { entries: ownedEntries } = useOwnedChogMetadata(address);
  const { record } = useLocalFills(address);
  const [traitType, setTraitType] = useState("");
  const [traitValue, setTraitValue] = useState("");

  const ownsRequested = useMemo(
    () => !!address && (deal?.requestedIds ?? []).every((tokenId) => owners.get(tokenId)?.toLowerCase() === address.toLowerCase()),
    [address, owners, deal?.requestedIds],
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
  const traitReady = !!deal?.requestedRoot
    && deal.requestedCount === BigInt(selectedTraitIds.length)
    && traitSet.root.toLowerCase() === deal.requestedRoot.toLowerCase();
  const isTraitDeal = !!deal?.requestedRoot && !!deal.requestedCount && deal.requestedCount > 0n;

  if (isLoading) return <EmptyState>Loading deal…</EmptyState>;
  // A missing id reverts on-chain; anything else (network, RPC) is a failed load, not a missing deal.
  if (error && describeError(error).kind !== "reverted") return <LoadError title="Couldn&apos;t load this deal" error={error} />;
  if (error || !deal) return <EmptyState>This deal does not exist.</EmptyState>;

  const status = displayStatus(deal, now);
  const maker = sameAddress(deal.maker, address);
  const canFill = status === "open" && !maker && (!deal.taker || sameAddress(deal.taker, address))
    && (isTraitDeal ? traitReady : ownsRequested);

  async function runFill() {
    const receipt = isTraitDeal
      ? await action.run({
        ...swap,
        functionName: "fillTrade",
        args: [id, selectedTraitIds, selectedTraitIds.map((tokenId) => traitSet.proofs.get(tokenId) ?? [])],
        value: deal!.requestedMon,
      })
      : await action.run({ ...swap, functionName: "fillTrade", args: [id], value: deal!.requestedMon });
    if (receipt) record(id);
  }

  return (
    <>
      <PageHeader title={`Deal #${id.toString()}`}>
        <StatusBadge status={status} />
      </PageHeader>
      <div className="space-y-6">
        <div className="card grid gap-6 p-5 md:grid-cols-2">
          <div><div className="label">Maker gives</div><DealSide ids={deal.offeredIds} mon={deal.offeredMon} /></div>
          <div>
            <div className="label">Taker gives</div>
            {deal.requestedRoot && deal.requestedCount && deal.requestedCount > 0n
              ? <div className="space-y-3">
                <TraitRequestSummary
                  filter={traitType && traitValue ? { traitType, value: traitValue } : undefined}
                  count={deal.requestedCount}
                  root={deal.requestedRoot}
                />
                <div className="text-sm">
                  <label className="label" htmlFor="accept-trait">Trait</label>
                  <Select
                    id="accept-trait"
                    value={traitType ? `${traitType}:${traitValue}` : ""}
                    placeholder="Select a trait from your assets"
                    options={[
                      { value: "", label: "Select a trait from your assets" },
                      ...traitOptions.map((option) => ({
                        value: `${option.type}:${option.value}`,
                        label: `${option.type}: ${option.value}`,
                      })),
                    ]}
                    onChange={(picked) => {
                      const [type = "", ...value] = picked.split(":");
                      setTraitType(type);
                      setTraitValue(value.join(":"));
                    }}
                  />
                </div>
                <p className="text-xs text-muted">
                  Matching owned assets: {selectedTraitIds.length}. Select the trait committed by the maker.
                </p>
                {traitType && !traitReady && <p className="text-xs text-warn">This selection does not match the maker’s committed set.</p>}
              </div>
              : <DealSide ids={deal.requestedIds} mon={deal.requestedMon} />}
          </div>
          <div className="text-sm text-muted">Created by <span className="font-mono">{deal.maker}</span></div>
          <div className="text-sm text-muted">{deal.expiry === 0n ? "No expiry" : `Expires ${formatDate(deal.expiry)}`}</div>
        </div>
        <div className="card space-y-3 p-5">
          <div className="flex justify-between"><span>Maker</span><span className="text-mint">✓ deposited</span></div>
          <div className="flex justify-between"><span>Taker</span><span className="text-warn">✗ pays on accept</span></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {status === "open" && maker && <TxButton state={action.state} variant="danger" onClick={() => action.run({ ...swap, functionName: "cancelTrade", args: [id] })}>Cancel deal</TxButton>}
          {status === "expired" && <TxButton state={action.state} onClick={() => action.run({ ...swap, functionName: "reclaimExpired", args: [id] })}>Reclaim to maker</TxButton>}
          {canFill && !isApproved && <TxButton state={action.state} onClick={() => action.run(approveCall)}>Approve collection</TxButton>}
          {canFill && isApproved && (!deal.requestedRoot || traitReady) && <TxButton state={action.state} onClick={runFill}>Accept &amp; swap</TxButton>}
          {status === "open" && !maker && !canFill && <p className="text-sm text-muted">{isTraitDeal ? "Select the maker’s committed trait and matching assets to accept this deal." : deal.taker && !sameAddress(deal.taker, address) ? "This is a private offer for another wallet." : "You don’t own every requested asset."}</p>}
          {status !== "open" && status !== "expired" && <p className="text-sm text-muted">This deal is settled and read-only.</p>}
          <Link href="/deals" className="btn-secondary">Back to deals</Link>
        </div>
        <TxStatus state={action.state} />
      </div>
    </>
  );
}
