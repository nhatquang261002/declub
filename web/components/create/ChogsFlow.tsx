"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEventLogs } from "viem";
import { useConnection } from "wagmi";
import { ChogPicker, ChogThumb } from "@/components/Chog";
import { TraitRequestSummary } from "@/components/TraitRequest";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useChogCatalog, useChogOwners, useOwnedChogs } from "@/hooks/useChogs";
import { useTxFlow } from "@/hooks/useTxFlow";
import { onDealAbi } from "@/lib/abi";
import { CHOG_ADDRESS, MAX_TOKENS_PER_SIDE } from "@/lib/config";
import { swap } from "@/lib/contracts";
import { expiryTimestamp, takerAddress, takerError, type Step, type Terms } from "@/lib/createFlow";
import { formatMon, parseIds, parseMon } from "@/lib/format";
import { buildMerkleSet } from "@/lib/merkle";
import { idsWithTrait, traitOptions } from "@/lib/traitRequests";
import { ConfirmCard, NextButton, ReviewCard, ReviewTerms, StepHeading, StepNav, TermsFields } from "./parts";
import { PREVIEW_CATALOG, PREVIEW_IDS } from "./previewData";
import { TraitPicker } from "./TraitPicker";

type Props = {
  kind: "exact" | "trait";
  step: Step;
  onStep: (step: Step) => void;
  terms: Terms;
  onTerms: (terms: Terms) => void;
  preview: boolean;
};

const NO_IDS: bigint[] = [];

/**
 * Chogs and MON on the original OnDeal contract: exact Chog requests (when V2 isn't
 * configured) and trait requests, which only exist here (ADR 0006).
 */
export function ChogsFlow({ kind, step, onStep, terms, onTerms, preview }: Props) {
  const { address } = useConnection();
  const router = useRouter();
  const owned = useOwnedChogs(address);
  const catalog = useChogCatalog({ enabled: kind === "trait" && !preview });
  const { isApproved, approveCall } = useChogApproval(address);
  const approval = useTxFlow();
  const tx = useTxFlow();

  const [offered, setOffered] = useState<bigint[]>([]);
  const [offeredMonText, setOfferedMonText] = useState("");
  const [requestedText, setRequestedText] = useState("");
  const [requestedMonText, setRequestedMonText] = useState("");
  const [traitType, setTraitType] = useState("");
  const [traitValue, setTraitValue] = useState("");

  const isTrait = kind === "trait";
  const offeredMon = parseMon(offeredMonText);
  const requestedMon = parseMon(requestedMonText);

  const parsedIds = useMemo(() => parseIds(requestedText), [requestedText]);
  const requested = useMemo(() => parsedIds ?? NO_IDS, [parsedIds]);
  const { owners, isLoading: ownersLoading } = useChogOwners(isTrait ? NO_IDS : requested);

  const entries = preview ? PREVIEW_CATALOG : catalog.entries;
  const filter = { traitType, value: traitValue };
  const traitSet = buildMerkleSet(isTrait && traitValue ? idsWithTrait(entries, filter) : NO_IDS, CHOG_ADDRESS);

  // What blocks "Continue" on step 1 (the ask) and step 2 (the offer and terms).
  const askError = ((): string | null => {
    if (requestedMon === null) return "Enter a valid MON amount.";
    if (isTrait) return traitSet.count > 0 ? null : "Choose a trait that matches at least one Chog.";
    if (requestedText.trim() && parsedIds === null) return "Enter Chog ids like 1, 2, #3.";
    if (requested.length === 0 && requestedMon === 0n) return "Name at least one Chog id, or some MON.";
    if (requested.length > MAX_TOKENS_PER_SIDE) return `Up to ${MAX_TOKENS_PER_SIDE} Chogs per side.`;
    if (new Set(requested.map(String)).size !== requested.length) return "Each Chog id can only be listed once.";
    if (ownersLoading) return "Checking the Chogs…";
    if (requested.some((id) => owners.get(id) === null)) return "Every requested Chog must exist.";
    return null;
  })();

  const offerError = ((): string | null => {
    if (offeredMon === null) return "Enter a valid MON amount.";
    if (offered.length === 0 && offeredMon === 0n) return "Pick at least one Chog, or enter some MON to give.";
    if (offeredMon > 0n && (requestedMon ?? 0n) > 0n) return "MON can only be on one side of a deal.";
    if (!isTrait && offered.some((id) => requested.includes(id))) return "A Chog can't be on both sides.";
    const taker = takerError(terms.taker, address);
    if (taker) return taker;
    const only = terms.taker.trim().toLowerCase();
    if (only && requested.some((id) => owners.get(id)?.toLowerCase() !== only)) {
      return "That wallet doesn't currently own every Chog you're requesting.";
    }
    return null;
  })();

  const needsApproval = offered.length > 0 && !isApproved;

  function toggle(id: bigint) {
    setOffered((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function create() {
    if (!address || askError || offerError || offeredMon === null || requestedMon === null) return;
    const expiry = expiryTimestamp(terms.expiry);
    const to = takerAddress(terms.taker);
    const receipt = await tx.run(
      isTrait
        ? { ...swap, functionName: "createTrade", args: [offered, traitSet.root, traitSet.count, requestedMon, to, expiry], value: offeredMon }
        : { ...swap, functionName: "createTrade", args: [offered, requested, requestedMon, to, expiry], value: offeredMon },
    );
    if (!receipt) return;
    const logs = parseEventLogs({
      abi: onDealAbi,
      eventName: isTrait ? "TraitTradeCreated" : "TradeCreated",
      logs: receipt.logs,
    });
    const id = logs[0]?.args.tradeId;
    if (id !== undefined) router.push(`/deal/${id.toString()}`);
  }

  if (step === 1) {
    return (
      <div className="space-y-6">
        <StepHeading
          title={isTrait ? "Which trait do you want?" : "Which Chogs do you want?"}
          blurb={isTrait ? undefined : "Name them by id. You'll see who owns each one."}
        />
        <section className="page-section space-y-4 p-4">
          {isTrait ? (
            <TraitPicker
              options={traitOptions(entries)}
              traitType={traitType}
              traitValue={traitValue}
              onType={(type) => {
                setTraitType(type);
                setTraitValue("");
              }}
              onValue={setTraitValue}
              loading={!preview && catalog.isLoading}
              count={traitSet.count}
              root={traitSet.root}
            />
          ) : (
            <div>
              <label className="label" htmlFor="requested-ids">Chog ids you want</label>
              <input
                id="requested-ids"
                className="input"
                placeholder="1, 2, #3"
                value={requestedText}
                onChange={(e) => setRequestedText(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">
                Separate ids with commas or spaces.{requested.length > 0 && ` ${requested.length} checked.`}
              </p>
            </div>
          )}
          <MonField id="requested-mon" label="MON you also want (optional)" value={requestedMonText} onChange={setRequestedMonText} />
        </section>
        <StepNav hint={askError}>
          <NextButton disabled={!!askError} onClick={() => onStep(2)} />
        </StepNav>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-6">
        <StepHeading title="What are you giving?" blurb="These are locked in escrow until someone accepts or you cancel." />
        <section className="page-section space-y-4 p-4">
          <div>
            <h3 className="label">Chogs you give</h3>
            <ChogPicker
              ids={preview ? PREVIEW_IDS : owned.ids}
              selected={offered}
              onToggle={toggle}
              max={MAX_TOKENS_PER_SIDE}
              isLoading={!preview && owned.isLoading}
              empty="No Chogs in this wallet. Mint or receive one first."
              preferLocalArtwork={preview}
            />
          </div>
          <MonField id="offered-mon" label="MON you also give (optional)" value={offeredMonText} onChange={setOfferedMonText} />
        </section>
        <TermsFields terms={terms} onChange={onTerms} takerLabel="Only this wallet can accept (optional)" />
        <StepNav onBack={() => onStep(1)} hint={offerError}>
          <NextButton disabled={!!offerError} onClick={() => onStep(3)} />
        </StepNav>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeading title="Review and confirm" blurb="Check both sides. Once it's on-chain you can cancel, but not edit." />
      <div className="grid gap-6 md:grid-cols-2">
        <ReviewCard title="You give" note="Locked in escrow until you accept or cancel.">
          <ChogAssets ids={offered} mon={offeredMon ?? 0n} />
        </ReviewCard>
        <ReviewCard title="You get" note="Sent straight to you when someone accepts.">
          {isTrait ? (
            <div className="space-y-2">
              <TraitRequestSummary filter={filter} count={traitSet.count} root={traitSet.root} />
              {(requestedMon ?? 0n) > 0n && <ChogAssets ids={NO_IDS} mon={requestedMon ?? 0n} />}
            </div>
          ) : (
            <ChogAssets ids={requested} mon={requestedMon ?? 0n} />
          )}
        </ReviewCard>
      </div>
      <ReviewTerms kindLabel={isTrait ? "Request by trait" : "Exact Chogs"} terms={terms} whoLabel="Who can accept" />
      <ConfirmCard
        onBack={() => onStep(2)}
        note="On Deal locks your offered assets in escrow. The requested side is transferred only when someone accepts."
        status={
          <>
            <TxStatus state={approval.state} success="On Deal is approved." />
            <TxStatus state={tx.state} success="Deal created." />
          </>
        }
      >
        {needsApproval ? (
          <TxButton state={approval.state} disabled={preview} onClick={() => approval.run(approveCall)}>
            Approve your Chogs
          </TxButton>
        ) : (
          <TxButton state={tx.state} disabled={preview || !!askError || !!offerError} onClick={create}>
            Create deal
          </TxButton>
        )}
      </ConfirmCard>
    </div>
  );
}

function MonField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input sm:max-w-56" inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Chog thumbnails and/or a MON amount, for one side of the review. */
function ChogAssets({ ids, mon }: { ids: readonly bigint[]; mon: bigint }) {
  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {ids.map((id) => (
            <ChogThumb key={id.toString()} id={id} large />
          ))}
        </div>
      )}
      {mon > 0n && <p className="rounded-lg bg-black/5 px-3 py-2 text-sm font-semibold">{formatMon(mon)}</p>}
    </div>
  );
}
