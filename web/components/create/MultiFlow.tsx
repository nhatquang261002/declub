"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEventLogs, type Address } from "viem";
import { useConnection } from "wagmi";
import { AssetEditor } from "@/components/AssetEditor";
import { AssetList } from "@/components/AssetList";
import { TxButton, TxStatus } from "@/components/Tx";
import { useAssetApprovals } from "@/hooks/useAssetApprovals";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useTxFlow } from "@/hooks/useTxFlow";
import { draftToAssets, draftTokens, newRow, overlapError, type DraftRow } from "@/lib/assetDraft";
import { toRawAsset } from "@/lib/assets";
import { MAX_NOTE_BYTES } from "@/lib/config";
import { swapV2, swapV2Abi } from "@/lib/contracts";
import { expiryTimestamp, takerAddress, takerError, type Step, type Terms } from "@/lib/createFlow";
import { noteBytes } from "@/lib/dealsV2";
import { NextButton, ReviewCard, ReviewTerms, StepHeading, StepNav, TermsFields } from "./parts";

type Props = {
  kind: "open" | "exact";
  step: Step;
  onStep: (step: Step) => void;
  terms: Terms;
  onTerms: (terms: Terms) => void;
  preview: boolean;
};

/**
 * Open offers and exact requests on ChogSwapV2: any mix of MON, ERC-20s and NFTs on each side.
 * Owns the asset rows, so going back a step or switching between the two kinds keeps them.
 */
export function MultiFlow({ kind, step, onStep, terms, onTerms, preview }: Props) {
  const { address } = useConnection();
  const router = useRouter();
  const approval = useTxFlow();
  const tx = useTxFlow();

  const [offeredRows, setOfferedRows] = useState<DraftRow[]>(() => [newRow("erc721")]);
  const [requestedRows, setRequestedRows] = useState<DraftRow[]>(() => [newRow("native")]);
  const [note, setNote] = useState("");

  // Decimals and symbols come from the token contracts, for both sides at once.
  const tokens = useMemo(() => draftTokens([...offeredRows, ...requestedRows]), [offeredRows, requestedRows]);
  const { info } = useTokenInfo(tokens);
  const decimalsOf = (token: Address) => info.get(token.toLowerCase())?.decimals;

  const isOpen = kind === "open";
  const offered = draftToAssets(offeredRows, decimalsOf);
  const requested = draftToAssets(requestedRows, decimalsOf);
  const bytes = noteBytes(note);

  // What blocks "Continue" on step 1 (the ask) and step 2 (the offer and terms).
  const askError = isOpen
    ? bytes > MAX_NOTE_BYTES ? `The note is ${bytes} bytes; the limit is ${MAX_NOTE_BYTES}.` : null
    : (requested.errors[0] ?? null);
  const offerError =
    offered.errors[0] ??
    (isOpen ? null : overlapError(offered.assets, requested.assets)) ??
    takerError(terms.taker, address);

  const { steps } = useAssetApprovals(address, offered.assets, info);
  const nextApproval = askError || offerError ? undefined : steps[0];

  async function create() {
    if (!address || !swapV2 || askError || offerError) return;
    const native = offered.assets.find((a) => a.kind === "native")?.amount ?? 0n;
    const expiry = expiryTimestamp(terms.expiry);
    const to = takerAddress(terms.taker);
    const receipt = isOpen
      ? await tx.run({
          ...swapV2,
          functionName: "createOpenOffer",
          args: [offered.assets.map(toRawAsset), to, expiry, note.trim()],
          value: native,
        })
      : await tx.run({
          ...swapV2,
          functionName: "createTrade",
          args: [offered.assets.map(toRawAsset), requested.assets.map(toRawAsset), to, expiry],
          value: native,
        });
    if (!receipt) return;
    const id = parseEventLogs({ abi: swapV2Abi, eventName: "TradeCreated", logs: receipt.logs })[0]?.args.tradeId;
    if (id !== undefined) router.push(`/v2/deal/${id.toString()}`);
  }

  if (step === 1) {
    return (
      <div className="space-y-6">
        <StepHeading
          title={isOpen ? "What are you looking for?" : "What do you want in return?"}
          blurb={isOpen ? "Describe it in a few words. Offers are sent to you on the deal page." : undefined}
        />
        {isOpen ? (
          <section className="page-section space-y-3 p-4">
            <div>
              <label className="label !mb-0" htmlFor="note">Note (optional)</label>
              <p className="mt-1 text-xs text-muted">
                Anyone can send you an offer. This note is a hint for them: it isn&apos;t enforced, and you can accept any offer.
              </p>
            </div>
            <textarea
              id="note"
              className="input min-h-24 resize-y"
              placeholder="e.g. any Chog with a crown, or 500 mUSD"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className={`text-right text-xs ${bytes > MAX_NOTE_BYTES ? "text-danger" : "text-muted"}`}>
              {bytes} / {MAX_NOTE_BYTES}
            </p>
          </section>
        ) : (
          <AssetEditor
            title="You request"
            hint="Sent straight to you when someone accepts. Nothing is held for this side."
            rows={requestedRows}
            onChange={setRequestedRows}
            info={info}
          />
        )}
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
        <AssetEditor title="You offer" rows={offeredRows} onChange={setOfferedRows} info={info} />
        <TermsFields
          terms={terms}
          onChange={onTerms}
          takerLabel={isOpen ? "Only this wallet can send offers (optional)" : "Only this wallet can accept (optional)"}
        />
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
          <AssetList assets={offered.assets} info={info} />
        </ReviewCard>
        {isOpen ? (
          <ReviewCard title="You're looking for" note="Not enforced. You can accept any offer.">
            <p className="whitespace-pre-wrap break-words text-sm">
              {note.trim() || "Nothing specified. Anyone can send you an offer."}
            </p>
          </ReviewCard>
        ) : (
          <ReviewCard title="You get" note="Sent straight to you when someone accepts.">
            <AssetList assets={requested.assets} info={info} />
          </ReviewCard>
        )}
      </div>
      <ReviewTerms
        kindLabel={isOpen ? "Open offer" : "Exact assets"}
        terms={terms}
        whoLabel={isOpen ? "Who can send offers" : "Who can accept"}
      />
      <div className="card space-y-3 p-4">
        <p className="text-sm text-muted">
          On Deal locks what you offer in escrow. Tokens that take a fee on transfer, or change balances on their own,
          aren&apos;t supported and the deal will be refused.
        </p>
        {nextApproval ? (
          <TxButton state={approval.state} disabled={preview} onClick={() => approval.run(nextApproval.call)}>
            {nextApproval.label}
            {steps.length > 1 ? ` (1 of ${steps.length})` : ""}
          </TxButton>
        ) : (
          <TxButton state={tx.state} disabled={preview || !!askError || !!offerError} onClick={create}>
            {isOpen ? "Post open offer" : "Create deal"}
          </TxButton>
        )}
        <TxStatus state={approval.state} success="Approved." />
        <TxStatus state={tx.state} success="Deal created." />
      </div>
      <StepNav onBack={() => onStep(2)} />
    </div>
  );
}
