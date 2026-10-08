"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { AssetEditor } from "@/components/AssetEditor";
import { AssetList } from "@/components/AssetList";
import { Alert } from "@/components/Alert";
import { FeeNote } from "@/components/FeeNote";
import { TrustCheck } from "@/components/TrustCheck";
import { TxButton, TxStatus } from "@/components/Tx";
import { useAssetApprovals } from "@/hooks/useAssetApprovals";
import { useAssetTrust } from "@/hooks/useAssetTrust";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useTxFlow } from "@/hooks/useTxFlow";
import { allVerified, blockedProblem, sideTrust } from "@/lib/assetTrust";
import { draftToAssets, draftTokens, newRow, overlapError, type DraftRow } from "@/lib/assetDraft";
import { feeUnits, sideFee, toRawAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { swapEscrow } from "@/lib/contracts";
import type { ProposalStatus, Proposal } from "@/lib/proposals";
import { sameAddress } from "@/lib/deals";
import { Who } from "@/components/Who";

type Info = ReadonlyMap<string, TokenInfo>;

const BADGE: Record<ProposalStatus, string> = {
  active: "chip-mint",
  accepted: "chip-blue",
  withdrawn: "",
  rejected: "chip-danger",
};

/** The maker's note, as plain text. It is not verified and binds nobody. */
export function OfferNote({ note }: { note: string }) {
  if (!note) return <p className="text-sm text-muted">The maker didn&apos;t say what they want. Send an offer.</p>;
  return (
    <div className="space-y-1.5">
      {/* Plain text only: React escapes it, and it is never turned into links or markup. */}
      <p className="text-sm break-words whitespace-pre-wrap">{note}</p>
      <p className="text-xs text-muted">Written by the maker. Not verified, and not binding. Check the assets, not the note.</p>
    </div>
  );
}

/**
 * The offers on an open offer, newest first. The maker accepts or rejects an active one; the
 * wallet that made one can withdraw it at any time, even after the deal has settled (its
 * assets stay in escrow until then).
 */
export function ProposalList({
  proposals,
  total,
  hasMore,
  onLoadMore,
  info,
  dealId,
  canDecide,
}: {
  proposals: readonly Proposal[];
  total: bigint;
  hasMore: boolean;
  onLoadMore: () => void;
  info: Info;
  dealId: bigint;
  /** The maker, while the deal is open and not expired. */
  canDecide: boolean;
}) {
  const active = proposals.filter((p) => p.status === "active");
  const closed = proposals.filter((p) => p.status !== "active");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-2xl font-black tracking-tight">Offers</h2>
        <span className="chip chip-dark tabular-nums">{total.toString()}</span>
        {active.length > 0 && <span className="text-sm text-muted">{active.length} waiting for the maker</span>}
      </div>
      {proposals.length === 0 && (
        <div className="deal-panel px-6 py-10 text-center">
          <p className="font-bold">No offers yet</p>
          <p className="mt-1 text-sm text-muted">The first one could be yours.</p>
        </div>
      )}
      {active.map((p) => (
        <ProposalRow key={p.id.toString()} proposal={p} info={info} dealId={dealId} canDecide={canDecide} />
      ))}
      {closed.length > 0 && (
        <details className="space-y-3">
          <summary className="cursor-pointer text-sm font-bold text-muted hover:text-[#111318]">Closed offers ({closed.length})</summary>
          <div className="mt-3 space-y-3">
            {closed.map((p) => (
              <ProposalRow key={p.id.toString()} proposal={p} info={info} dealId={dealId} canDecide={false} />
            ))}
          </div>
        </details>
      )}
      {hasMore && (
        <button type="button" className="btn-secondary" onClick={onLoadMore}>
          Load older offers
        </button>
      )}
    </section>
  );
}

function ProposalRow({ proposal, info, dealId, canDecide }: { proposal: Proposal; info: Info; dealId: bigint; canDecide: boolean }) {
  const { address } = useConnection();
  const decide = useTxFlow();
  const mine = sameAddress(proposal.proposer, address);
  const isActive = proposal.status === "active";
  const call = (functionName: "acceptProposal" | "rejectProposal" | "withdrawProposal") =>
    decide.run({ ...swapEscrow!, functionName, args: [dealId, proposal.id] });
  // The maker receives this offer's assets: unverified ones need a tick, blocked ones can't be taken (ADR 0014).
  const trust = sideTrust(proposal.assets, useAssetTrust(proposal.assets, info));
  const [checked, setChecked] = useState(false);
  const deciding = isActive && canDecide;
  const acceptBlocked = trust.blocked.length > 0 || (!allVerified(trust) && !checked);

  return (
    <div className="offer-card space-y-3 p-4" data-status={proposal.status}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-black">
          Offer <span className="text-accent">#</span>
          {proposal.id.toString()}
        </span>
        <span className={`chip uppercase tracking-wide ${BADGE[proposal.status]}`}>{proposal.status}</span>
        {mine && <span className="chip chip-dark">Yours</span>}
        <span className="ml-auto text-xs text-muted">
          from <Who address={proposal.proposer} mine={mine} />
        </span>
      </div>
      <AssetList assets={proposal.assets} info={info} />
      {deciding && <TrustCheck side={trust} info={info} confirmed={checked} onConfirm={setChecked} receiving="this offer gives you" />}
      {isActive && (canDecide || mine) && (
        <div className="flex flex-wrap items-center gap-3">
          {canDecide && (
            <>
              <TxButton state={decide.state} disabled={acceptBlocked} onClick={() => call("acceptProposal")}>
                Accept &amp; swap
              </TxButton>
              <TxButton state={decide.state} variant="secondary" onClick={() => call("rejectProposal")}>
                Reject
              </TxButton>
            </>
          )}
          {mine && (
            <TxButton state={decide.state} variant="secondary" onClick={() => call("withdrawProposal")}>
              Withdraw my offer
            </TxButton>
          )}
        </div>
      )}
      <TxStatus state={decide.state} />
    </div>
  );
}

/**
 * Lock assets in escrow as an offer on someone's open offer. `fee` is the open offer's own
 * (`deal.fee`): a proposer pays what the maker listed with, whatever the fee is now (ADR 0018).
 */
export function ProposalForm({ dealId, offered, fee }: { dealId: bigint; offered: readonly Asset[]; fee: bigint }) {
  const { address } = useConnection();
  const approval = useTxFlow();
  const tx = useTxFlow();
  const [rows, setRows] = useState<DraftRow[]>(() => [newRow("native")]);
  const [validation, setValidation] = useState<string | null>(null);

  const tokens = useMemo(() => draftTokens(rows), [rows]);
  const { info } = useTokenInfo(tokens);
  const decimalsOf = (token: Address) => info.get(token.toLowerCase())?.decimals;

  const draft = draftToAssets(rows, decimalsOf);
  const problems = draft.errors.map((e) => `Your offer — ${e}`);
  const overlap = problems.length === 0 ? (overlapError(offered, draft.assets) ?? blockedProblem(draft.assets)) : null;

  const { steps } = useAssetApprovals(address, draft.assets, info);
  const nextApproval = problems.length === 0 ? steps[0] : undefined;

  async function send() {
    if (problems.length > 0) return setValidation(problems[0]);
    if (overlap) return setValidation(overlap);
    setValidation(null);
    // The native amount in the offer, plus this wallet's share of the protocol fee: one per NFT it offers.
    const native = (draft.assets.find((a) => a.kind === "native")?.amount ?? 0n) + sideFee(fee, draft.assets);
    const receipt = await tx.run({
      ...swapEscrow!,
      functionName: "propose",
      args: [dealId, draft.assets.map(toRawAsset)],
      value: native,
    });
    if (receipt) setRows([newRow("native")]);
  }

  return (
    <section className="space-y-4">
      <AssetEditor
        title="Send an offer"
        hint="Locked in escrow while the maker decides. You can take it back any time before they accept."
        rows={rows}
        onChange={setRows}
        info={info}
        owner={address}
      />
      <div className="deal-panel space-y-3 p-4">
        {(validation ?? overlap) && (
          <Alert tone="warn" title="Check your offer">
            {validation ?? overlap}
          </Alert>
        )}
        {problems.length > 0 && !validation && <p className="text-xs text-muted">{problems[0]}</p>}
        <FeeNote amount={fee} units={feeUnits(draft.assets)}>
          Sent with your offer and held with it, once for each NFT in it. It&apos;s only charged if the maker accepts. If you withdraw it, or the maker rejects
          it, it comes back to you.
        </FeeNote>
        {nextApproval ? (
          <TxButton state={approval.state} onClick={() => approval.run(nextApproval.call)}>
            {nextApproval.label}
            {steps.length > 1 ? ` (1 of ${steps.length})` : ""}
          </TxButton>
        ) : (
          <TxButton state={tx.state} disabled={problems.length > 0 || !!overlap} onClick={send}>
            Send offer
          </TxButton>
        )}
        <TxStatus state={approval.state} success="Approved." />
        <TxStatus state={tx.state} success="Offer sent." />
      </div>
    </section>
  );
}
