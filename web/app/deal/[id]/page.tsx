"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useConnection } from "wagmi";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState } from "@/components/Page";
import { ConnectButton } from "@/components/ConnectButton";
import { describeError } from "@/lib/errors";
import { DealSide, SettlementTag, STATUS_TEXT } from "@/components/DealParts";
import {
  BackToDeals,
  DealByline,
  DealDock,
  DealFacts,
  DealSheet,
  DealSheetHead,
  DealStage,
  DealStageSide,
  DealStamp,
  DealSteps,
  DealTitle,
  sideTitles,
  stepsOf,
  type Party,
} from "@/components/DealSheet";
import { LockIcon } from "@/components/Icons";
import { TraitRequestSummary } from "@/components/TraitRequest";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useChogOwners, useOwnedChogMetadata } from "@/hooks/useChogs";
import { useFills } from "@/hooks/useFills";
import { useDeal } from "@/hooks/useDeal";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useNow } from "@/hooks/useNow";
import { displayStatus, sameAddress } from "@/lib/deals";
import { Select } from "@/components/Select";
import { Who } from "@/components/Who";
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
  const { record } = useFills(address);
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
  const forMe = !!deal.taker && sameAddress(deal.taker, address);
  const allowed = !maker && (!deal.taker || forMe);
  const canFill = status === "open" && allowed && (isTraitDeal ? traitReady : ownsRequested);
  // Someone who could take this deal, whether or not they can yet: they get the steps.
  const taking = status === "open" && allowed && !!address;
  const party: Party = maker ? "maker" : taking ? "taker" : undefined;
  const titles = sideTitles(party);
  const settled = status === "filled" || status === "cancelled";

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

  const traitPicker = (
    <div className="space-y-2 text-sm">
      <label className="label" htmlFor="accept-trait">The trait you&apos;re sending</label>
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
      <p className="text-xs text-muted">
        Matching owned assets: {selectedTraitIds.length}. Select the trait committed by the maker.
      </p>
      {traitType && !traitReady && <p className="text-xs text-warn">This selection does not match the maker’s committed set.</p>}
    </div>
  );

  return (
    <>
      <BackToDeals />
      <div className="space-y-8">
        <DealSheet>
          <DealSheetHead
            chips={
              <>
                <SettlementTag signed={false} />
                {forMe && <span className="chip chip-peach">★ For you</span>}
                {maker && <span className="chip chip-dark">Your deal</span>}
                {isTraitDeal && <span className="chip">Request by trait</span>}
              </>
            }
            title={<DealTitle id={id.toString()} />}
            byline={<DealByline maker={deal.maker} mine={maker} expiry={deal.expiry} now={now} live={status === "open"} />}
            stamp={<DealStamp status={status} label={STATUS_TEXT[status]} />}
          />

          <DealStage
            status={status}
            live={status === "open"}
            gives={
              <DealStageSide
                side="give"
                title={titles.give}
                note={settled ? undefined : <><LockIcon /> In escrow</>}
                mine={party === "taker"}
              >
                <DealSide ids={deal.offeredIds} mon={deal.offeredMon} xl />
              </DealStageSide>
            }
            wants={
              <DealStageSide side="want" title={titles.want} mine={party === "maker"}>
                {isTraitDeal ? (
                  <TraitRequestSummary
                    filter={traitType && traitValue ? { traitType, value: traitValue } : undefined}
                    count={deal.requestedCount!}
                    root={deal.requestedRoot}
                  />
                ) : (
                  <DealSide ids={deal.requestedIds} mon={deal.requestedMon} xl />
                )}
              </DealStageSide>
            }
          />

          <DealFacts
            facts={[
              { label: "Who can accept", value: deal.taker ? <Who address={deal.taker} mine={forMe} /> : "Anyone" },
              { label: "Expires", value: deal.expiry === 0n ? "Never" : formatDate(deal.expiry) },
              // The whole address, where people are meant to check it against their counterparty.
              { label: "Maker's wallet", value: <span className="font-mono text-xs font-semibold">{deal.maker}</span> },
            ]}
          />
        </DealSheet>

        {settled ? (
          <DealDock tone="done" eyebrow="Settled" title={status === "filled" ? "This deal is done" : "This deal was cancelled"}>
            <p className="text-sm text-muted">
              {status === "filled" ? "Both sides swapped in one transaction." : "The maker called it off and took their Chogs back."}
            </p>
            <TxStatus state={action.state} success={status === "filled" ? "Swapped. The Chogs are in your wallet." : undefined} />
          </DealDock>
        ) : status === "expired" ? (
          <DealDock tone="warn" title="This deal ran out of time">
            <p className="text-sm text-muted">Nobody can accept it now. Anyone can send the locked assets back to the maker.</p>
            <div>
              <TxButton state={action.state} onClick={() => action.run({ ...swap, functionName: "reclaimExpired", args: [id] })}>
                {maker ? "Reclaim my assets" : "Return assets to maker"}
              </TxButton>
            </div>
            <TxStatus state={action.state} />
          </DealDock>
        ) : maker ? (
          <DealDock tone="maker" eyebrow="Your deal" title="Your deal is live">
            <p className="text-sm text-muted">Your side is in escrow until someone accepts. Cancel any time to take it back.</p>
            <div>
              <TxButton state={action.state} variant="danger" onClick={() => action.run({ ...swap, functionName: "cancelTrade", args: [id] })}>
                Cancel deal
              </TxButton>
            </div>
            <TxStatus state={action.state} />
          </DealDock>
        ) : !address ? (
          <DealDock title="Want this? Take the deal">
            <p className="text-sm text-muted">Connect a wallet to accept this deal.</p>
            <div>
              <ConnectButton />
            </div>
          </DealDock>
        ) : !allowed ? (
          <DealDock tone="blocked" title="This offer is for someone else">
            <p className="text-sm text-muted">
              Only <Who address={deal.taker!} /> can accept it.
            </p>
          </DealDock>
        ) : (
          <DealDock tone={!isTraitDeal && !ownsRequested ? "warn" : undefined} title="Take the deal">
            <DealSteps
              steps={stepsOf([
                ["Wallet connected", true],
                isTraitDeal ? ["Pick the trait", traitReady] : ["Hold the Chogs", ownsRequested],
                ["Approve Chogs", isApproved],
                ["Accept & swap", false],
              ])}
            />
            {isTraitDeal && traitPicker}
            {!isTraitDeal && !ownsRequested && (
              <p className="text-sm text-warn">You don’t own every requested asset, so you can&apos;t accept this one yet.</p>
            )}
            {canFill && (
              <div className="flex flex-wrap items-center gap-3">
                {!isApproved && <TxButton state={action.state} onClick={() => action.run(approveCall)}>Approve collection</TxButton>}
                {isApproved && (!deal.requestedRoot || traitReady) && <TxButton state={action.state} onClick={runFill}>Accept &amp; swap</TxButton>}
              </div>
            )}
            <TxStatus state={action.state} />
          </DealDock>
        )}
      </div>
    </>
  );
}
