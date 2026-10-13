"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useConnection } from "wagmi";
import { KindPicker, type KindAvailability } from "@/components/create/KindPicker";
import { MultiFlow } from "@/components/create/MultiFlow";
import { SettlementPicker } from "@/components/create/SettlementPicker";
import { SignedFlow } from "@/components/create/SignedFlow";
import { StepHeading } from "@/components/create/parts";
import { Stepper } from "@/components/create/Stepper";
import { Alert } from "@/components/Alert";
import { EmptyState, PageHeader, RequireWallet } from "@/components/Page";
import { useMatchDraft, type MatchDraft } from "@/hooks/useMatchDraft";
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
        <Suspense>
          <CreateEntry />
        </Suspense>
      </RequireWallet>
    </>
  );
}

/**
 * `/create?match=<swap id>` starts a signed swap that mirrors that one (a button on its page). The swap is read
 * once before the wizard mounts, so its later polls can't rebuild a form that is being filled in.
 */
function CreateEntry() {
  const { address } = useConnection();
  const draft = useMatchDraft(useSearchParams().get("match"), address);
  const [match, setMatch] = useState<MatchDraft | null>(null);
  if (!match && draft.state !== "loading") setMatch(draft);
  if (!match) return <EmptyState>Loading the swap to match…</EmptyState>;
  return <CreateWizard match={match} />;
}

function CreateWizard({ match }: { match: MatchDraft }) {
  const mirror = match.state === "ready" && swapIntents ? match : null;
  // A mirror starts on "what are you giving", where the deadline is chosen; the ask is already filled in.
  const [step, setStep] = useState<Step>(mirror ? 2 : 1);
  const [kind, setKind] = useState<DealKind | null>(null);
  const [settlement, setSettlement] = useState<Settlement>(mirror ? "signed" : "escrow");
  const signed = settlement === "signed" && !!swapIntents;
  const [terms, setTerms] = useState<Terms>(DEFAULT_TERMS);

  const flow = { step, onStep: setStep, terms, onTerms: setTerms };

  return (
    <div className="space-y-8">
      {mirror && (
        <Alert tone="info" title="Matching a signed swap">
          This is the other side of{" "}
          <Link href={`/intent/${mirror.hash}`} className="font-mono font-bold underline">
            {mirror.hash.slice(2, 10)}
          </Link>
          : you give what it wants and get what it gives. Check both sides, pick a deadline, then sign. The matcher settles the two together.
        </Alert>
      )}
      {match.state === "unavailable" && (
        <Alert tone="warn" title="Can't match that swap">
          {match.reason}
        </Alert>
      )}
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
          prefill={mirror ?? undefined}
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
