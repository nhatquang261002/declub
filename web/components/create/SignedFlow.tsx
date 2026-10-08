"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { AssetEditor } from "@/components/AssetEditor";
import { AssetList } from "@/components/AssetList";
import { ConsentNotice } from "@/components/IntentParts";
import { FeeNote } from "@/components/FeeNote";
import { Select } from "@/components/Select";
import { Alert } from "@/components/Alert";
import { TxButton, TxStatus } from "@/components/Tx";
import { useIntentReadiness, type NftScope } from "@/hooks/useIntentReadiness";
import { usePoolInfo } from "@/hooks/usePool";
import { useIntentFee } from "@/hooks/useProtocolFee";
import { useSignFlow } from "@/hooks/useSignFlow";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useTxFlow } from "@/hooks/useTxFlow";
import { draftToAssets, draftTokens, newRow, type DraftRow } from "@/lib/assetDraft";
import { feeUnits } from "@/lib/assets";
import { MOCK_ERC20_ADDRESS, POOL_URL } from "@/lib/config";
import type { Step } from "@/lib/createFlow";
import { DEADLINES, DEFAULT_DEADLINE, deadlineSeconds, intentProblem, type DeadlineKey } from "@/lib/intents";
import { ConfirmCard, NextButton, ReviewCard, ReviewStage, StepHeading, StepNav } from "./parts";
import { DealStageSide } from "@/components/DealSheet";

type Props = {
  step: Step;
  onStep: (step: Step) => void;
  /** Back to "Lock assets now", for a deal that needs MON or a trait request. */
  onUseEscrow: () => void;
};

/**
 * A signed swap on DeClubIntents (ADR 0008, 0009): the same three steps as an exact request,
 * but nothing is locked. The maker signs what they give and what they want; the only
 * transactions are approvals, so the contract can move the assets when a match settles.
 * Owns the asset rows, so going back a step keeps them.
 */
export function SignedFlow({ step, onStep, onUseEscrow }: Props) {
  const { address } = useConnection();
  const router = useRouter();
  const approval = useTxFlow();
  const sign = useSignFlow();
  const pool = usePoolInfo();
  const { fee, pending: pendingFee, isLoading: feeLoading } = useIntentFee();

  const [giveRows, setGiveRows] = useState<DraftRow[]>(() => [newRow("erc721")]);
  const [wantRows, setWantRows] = useState<DraftRow[]>(() => [newRow("erc20", MOCK_ERC20_ADDRESS ?? "")]);
  const [deadline, setDeadline] = useState<DeadlineKey>(DEFAULT_DEADLINE);
  const [scope, setScope] = useState<NftScope>("token");
  // Set once the swap is posted: the signing state is idle again by then, but its page is still opening.
  const [opening, setOpening] = useState(false);

  const feeTokenAddress = fee?.token;
  const tokens = useMemo(
    () => [...new Set([...draftTokens([...giveRows, ...wantRows]), ...(feeTokenAddress ? [feeTokenAddress] : [])])],
    [giveRows, wantRows, feeTokenAddress],
  );
  const { info } = useTokenInfo(tokens);
  const decimalsOf = (token: Address) => info.get(token.toLowerCase())?.decimals;

  const give = draftToAssets(giveRows, decimalsOf, { noNative: true });
  const want = draftToAssets(wantRows, decimalsOf, { noNative: true });
  const wantError = want.errors[0] ?? (want.assets.length === 0 ? "Add something you want in return." : null);
  const giveError = give.errors[0] ?? intentProblem(give.assets, want.assets);

  // Reads the chain only once the draft is sound, so typing doesn't fire a read per keystroke.
  // The readiness check multiplies the per-NFT fee by the NFTs given (ADR 0033).
  const readiness = useIntentReadiness(address, wantError || giveError ? [] : give.assets, info, scope, fee);
  const giveUnits = feeUnits(give.assets);
  const poolDown = !!pool.error || pool.mismatch;
  const feeBlocker = fee ? null : feeLoading ? "Reading the protocol fee from the contract…" : "Couldn't read the protocol fee from the contract.";
  const blocker = wantError ?? giveError ?? readiness.problems[0] ?? feeBlocker;
  const nextApproval = blocker ? undefined : readiness.steps[0];
  const hasNfts = give.assets.some((a) => a.kind === "erc721");

  async function submit() {
    if (!address || blocker || poolDown) return;
    const hash = await sign.post({ give: give.assets, want: want.assets, ttlSeconds: deadlineSeconds(deadline) });
    if (hash) {
      setOpening(true);
      router.push(`/intent/${hash}`);
    }
  }

  const escrowHint = (
    <p className="text-xs text-muted">
      Signed swaps can&apos;t include MON or a trait request.{" "}
      <button type="button" className="font-semibold underline hover:text-accent" onClick={onUseEscrow}>
        Lock assets instead
      </button>{" "}
      if you need either.
    </p>
  );

  if (step === 1) {
    return (
      <div className="space-y-6">
        <StepHeading
          title="What do you want in return?"
          blurb="Token amounts are a minimum: a match can pay more, and you keep the extra. NFTs must be exactly these."
        />
        <AssetEditor
          title="You want"
          rows={wantRows}
          onChange={setWantRows}
          info={info}
          allowNative={false}
          amountIsMinimum
        />
        {escrowHint}
        <StepNav hint={wantError}>
          <NextButton disabled={!!wantError} onClick={() => onStep(2)} />
        </StepNav>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-6">
        <StepHeading title="What are you giving?" blurb="Stays in your wallet until a match settles. Nothing is locked." />
        <AssetEditor title="You give" rows={giveRows} onChange={setGiveRows} info={info} allowNative={false} owner={address} />
        <section className="page-section grid gap-6 p-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="deadline">Good for</label>
            <Select
              id="deadline"
              value={deadline}
              options={DEADLINES.map(({ key, label }) => ({ value: key, label }))}
              onChange={setDeadline}
            />
            <p className="mt-1 text-xs text-muted">
              After this it can no longer settle. Shorter is safer: once a signature has left the pool, only cancelling it on-chain
              (which costs gas) stops it sooner.
            </p>
          </div>
          {hasNfts && (
            <div>
              <span className="label">NFT approvals</span>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={scope === "collection"}
                  onChange={(e) => setScope(e.target.checked ? "collection" : "token")}
                />
                <span>
                  Approve whole collections
                  <span className="block text-xs text-muted">
                    Fewer transactions, but the contract may move any NFT you own in that collection while a signed swap
                    is live. Off: one approval per NFT.
                  </span>
                </span>
              </label>
            </div>
          )}
        </section>
        {escrowHint}
        <StepNav onBack={() => onStep(1)} hint={giveError}>
          <NextButton disabled={!!giveError} onClick={() => onStep(3)} />
        </StepNav>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeading title="Review and sign" blurb="Check both sides. You can remove it later, but not edit it." />
      {poolDown && (
        <Alert tone="danger" title={pool.mismatch ? "Wrong intent pool" : "Can't reach the intent pool"}>
          {pool.mismatch
            ? `The pool at ${POOL_URL} is for a different chain or contract than this app.`
            : `Nothing answered at ${POOL_URL}. Start the matcher, then reload.`}
        </Alert>
      )}
      <ReviewStage
        give={
          <DealStageSide side="give" title="You give" note="Stays in your wallet">
            <AssetList assets={give.assets} info={info} />
            <p className="text-xs text-muted">Nothing is locked. It moves only when a match settles.</p>
          </DealStageSide>
        }
        want={
          <DealStageSide side="want" title="You get, at least" note="Sent to you on settle">
            <AssetList assets={want.assets} info={info} />
          </DealStageSide>
        }
      />
      <ReviewCard title="Terms">
        <dl className="space-y-1.5">
          {(
            [
              ["Deal type", "Signed swap (nothing locked)"],
              ["Who can settle it", "Anyone that meets what you want"],
              ["Expires", `In ${DEADLINES.find((d) => d.key === deadline)!.label}`],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-x-4 text-sm">
              <dt className="text-muted">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </ReviewCard>
      {fee && (
        <FeeNote
          amount={fee.amount}
          units={giveUnits}
          unit="WMON"
          pending={pendingFee}
          pendingNote="A swap signed now can't settle after that unless you sign it again at the new fee."
        >
          Signed with your swap as the most you&apos;ll pay for each NFT you give, and taken from your wallet only if it
          settles, in WMON (wrapped MON). If the fee is cut before then, you pay less. Every wallet in the match pays the
          same for each NFT it gives. If it never settles, you pay nothing. Holding only MON is fine: the first step wraps
          what you need.
        </FeeNote>
      )}
      <ConsentNotice />
      <ConfirmCard
        onBack={() => onStep(2)}
        note={blocker ?? "Signing is free. Approving the tokens you give, and the fee, is what lets the swap run later without another confirmation."}
        status={
          <>
            <TxStatus state={approval.state} success="Approved." />
            <TxStatus state={sign.state} />
          </>
        }
      >
        {nextApproval ? (
          <TxButton state={approval.state} onClick={() => approval.run(nextApproval.call)}>
            {nextApproval.label}
            {readiness.steps.length > 1 ? ` (1 of ${readiness.steps.length})` : ""}
          </TxButton>
        ) : (
          <TxButton
            state={sign.state}
            busyLabel={opening ? "Opening your swap…" : undefined}
            disabled={!!blocker || poolDown || readiness.isLoading}
            onClick={submit}
          >
            Sign and post
          </TxButton>
        )}
      </ConfirmCard>
    </div>
  );
}
