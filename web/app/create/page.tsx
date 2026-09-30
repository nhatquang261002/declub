"use client";

import { useState } from "react";
import { ChogsFlow } from "@/components/create/ChogsFlow";
import { KindPicker, type KindAvailability } from "@/components/create/KindPicker";
import { MultiFlow } from "@/components/create/MultiFlow";
import { StepHeading } from "@/components/create/parts";
import { Stepper } from "@/components/create/Stepper";
import { PageHeader, RequireWallet } from "@/components/Page";
import { DEMO_CREATE } from "@/lib/config";
import { swapV2 } from "@/lib/contracts";
import { DEFAULT_TERMS, type Step, type Terms, type DealKind } from "@/lib/createFlow";

// Open offers and V2 exact requests live on ChogSwapV2; trait requests only exist on the Chog
// contract (ADR 0006). Without V2 configured, exact requests fall back to the Chog contract too.
const AVAILABILITY: KindAvailability = {
  open: swapV2
    ? { scope: "Any tokens, NFTs and MON" }
    : { scope: "", unavailable: "Not available on this deployment yet" },
  exact: { scope: swapV2 ? "Any tokens, NFTs and MON" : "Chogs and MON" },
  trait: { scope: "Chogs and MON" },
};

export default function CreatePage() {
  return (
    <>
      <PageHeader title="Create a deal" />
      {DEMO_CREATE ? (
        <CreateWizard preview />
      ) : (
        <RequireWallet reason="Connect a wallet to create a deal.">
          <CreateWizard />
        </RequireWallet>
      )}
    </>
  );
}

function CreateWizard({ preview = false }: { preview?: boolean }) {
  const [step, setStep] = useState<Step>(1);
  const [kind, setKind] = useState<DealKind | null>(null);
  const [terms, setTerms] = useState<Terms>(DEFAULT_TERMS);

  const flow = { step, onStep: setStep, terms, onTerms: setTerms, preview };

  return (
    <div className="space-y-8">
      <Stepper current={step} onJump={setStep} />

      {step === 1 && (
        <section className="space-y-4">
          <StepHeading title="What kind of deal?" blurb="You'll choose what you give on the next step." />
          <KindPicker value={kind} onChange={setKind} availability={AVAILABILITY} />
          {!kind && <p className="text-sm text-muted">Choose a deal type to continue.</p>}
        </section>
      )}

      {/* Same key across kinds that share a contract, so switching between them keeps what you typed. */}
      {(kind === "open" || (kind === "exact" && swapV2)) && <MultiFlow key="multi" kind={kind} {...flow} />}
      {(kind === "trait" || (kind === "exact" && !swapV2)) && <ChogsFlow key="chogs" kind={kind} {...flow} />}
    </div>
  );
}
