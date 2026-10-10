"use client";

import { useState } from "react";
import { KindPicker, type KindAvailability } from "@/components/create/KindPicker";
import { MultiFlow } from "@/components/create/MultiFlow";
import { SettlementPicker } from "@/components/create/SettlementPicker";
import { SignedFlow } from "@/components/create/SignedFlow";
import { StepHeading } from "@/components/create/parts";
import { Stepper } from "@/components/create/Stepper";
import { PageHeader, RequireWallet } from "@/components/Page";
import { swapIntents, swapEscrow } from "@/lib/contracts";
import { DEFAULT_TERMS, type Step, type Terms, type DealKind, type Settlement } from "@/lib/createFlow";

// Open offers, exact requests and trait requests all live on DeClubEscrow (ADR 0005–0007).
const UNAVAILABLE = { scope: "", unavailable: "Not available on this deployment yet" };
const AVAILABILITY: KindAvailability = swapEscrow
  ? {
      open: { scope: "Any tokens, NFTs and MON" },
      exact: { scope: "Any tokens, NFTs and MON" },
      trait: { scope: "Any collection with readable traits" },
    }
  : { open: UNAVAILABLE, exact: UNAVAILABLE, trait: UNAVAILABLE };

/** What making a deal takes, shown before sign-in so the page says what it is for. */
const PREVIEW = [
  { title: "Pick what you give", body: "NFTs, tokens or MON from your wallet, bundles included." },
  { title: "Say what you want", body: "Exact NFTs or tokens, any NFT with a trait, or open to offers." },
  swapIntents
    ? { title: "Lock or sign", body: "Lock your side so the swap can't fail, or just sign and keep your assets until a match." }
    : { title: "Lock it", body: "Your side waits in the contract until someone accepts, it expires or you cancel." },
];

export default function CreatePage() {
  return (
    <>
      <PageHeader title="Create a deal" />
      <RequireWallet
        reason="Sign in with the wallet that holds your assets to start."
        preview={
          <ol className="mb-4 grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
            {PREVIEW.map((step, i) => (
              <li key={step.title} className="flex gap-3 sm:flex-col sm:gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-[#f0b735] text-sm font-black">{i + 1}</span>
                <span>
                  <span className="block font-bold">{step.title}</span>
                  <span className="mt-0.5 block text-sm leading-6 text-muted">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        }
      >
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
      {!signed && swapEscrow && kind && <MultiFlow key="multi" kind={kind} {...flow} />}
    </div>
  );
}
