"use client";

import { useState } from "react";
import { KindPicker, type KindAvailability } from "@/components/create/KindPicker";
import { MultiFlow } from "@/components/create/MultiFlow";
import { SettlementPicker } from "@/components/create/SettlementPicker";
import { SignedFlow } from "@/components/create/SignedFlow";
import { StepHeading } from "@/components/create/parts";
import { Stepper } from "@/components/create/Stepper";
import { PageHeader, RequireWallet } from "@/components/Page";
import { swapIntents, swapV2 } from "@/lib/contracts";
import { DEFAULT_TERMS, type Step, type Terms, type DealKind, type Settlement } from "@/lib/createFlow";

// Open offers, exact requests and trait requests all live on DeClubEscrow (ADR 0005–0007).
const UNAVAILABLE = { scope: "", unavailable: "Not available on this deployment yet" };
const AVAILABILITY: KindAvailability = swapV2
  ? {
      open: { scope: "Any tokens, NFTs and MON" },
      exact: { scope: "Any tokens, NFTs and MON" },
      trait: { scope: "Any collection with readable traits" },
    }
  : { open: UNAVAILABLE, exact: UNAVAILABLE, trait: UNAVAILABLE };

export default function CreatePage() {
  return (
    <>
      <PageHeader title="Create a deal" />
      <RequireWallet reason="Connect a wallet to create a deal.">
        <CreateWizard />
      </RequireWallet>
    </>
  );
}

function CreateWizard() {
  const [step, setStep] = useState<Step>(1);
  const [kind, setKind] = useState<DealKind | null>(null);
  const [settlement, setSettlement] = useState<Settlement>("escrow");
  const signed = settlement === "signed" && !!swapIntents;
  const [terms, setTerms] = useState<Terms>(DEFAULT_TERMS);

  const flow = { step, onStep: setStep, terms, onTerms: setTerms };

  return (
    <div className="space-y-8">
      <Stepper current={step} onJump={setStep} />

      {step === 1 && (
        <section className="space-y-4">
          {swapIntents && (
            <>
              <StepHeading title="How should it settle?" blurb="Lock your assets for a guaranteed swap, or just sign for free." />
              <SettlementPicker value={settlement} onChange={setSettlement} />
            </>
          )}
          {!signed && (
            <>
              <StepHeading title="What kind of deal?" blurb="You'll choose what you give on the next step." />
              <KindPicker value={kind} onChange={setKind} availability={AVAILABILITY} />
              {!kind && <p className="text-sm text-muted">Choose a deal type to continue.</p>}
            </>
          )}
        </section>
      )}

      {signed && (
        <SignedFlow
          key="signed"
          step={step}
          onStep={setStep}
          onUseEscrow={() => {
            setSettlement("escrow");
            setStep(1);
          }}
        />
      )}

      {/* Same key across kinds that share a contract, so switching between them keeps what you typed. */}
      {!signed && swapV2 && kind && <MultiFlow key="multi" kind={kind} {...flow} />}
    </div>
  );
}
