"use client";

import type { ReactNode } from "react";
import { explorerTx } from "@/lib/config";
import type { TxState } from "@/hooks/useTxFlow";
import { Alert, toneOf } from "./Alert";
import { Spinner } from "./Spinner";

const BUSY_LABEL: Partial<Record<TxState["status"], string>> = {
  "switching-chain": "Switching network…",
  preparing: "Preparing…",
  simulating: "Checking…",
  "awaiting-signature": "Confirm in wallet…",
  posting: "Sending to the pool…",
  pending: "Confirming on-chain…",
  syncing: "Finishing up…",
};

// What is happening, and what (if anything) the person has to do, beside the button.
const STAGE_NOTE: Partial<Record<TxState["status"], string>> = {
  "switching-chain": "Approve the network switch in your wallet.",
  preparing: "Getting everything ready to sign…",
  simulating: "Checking that it will go through before your wallet opens…",
  "awaiting-signature": "Waiting for you in your wallet. If nothing opened, check your wallet extension.",
  posting: "Signed. Sending it to the pool…",
  pending: "Submitted. Waiting for the network to confirm it…",
  syncing: "Done on-chain. Updating what you see…",
};

// Literal class names so Tailwind's scanner picks them up.
const VARIANT = { primary: "btn-primary", secondary: "btn-secondary", danger: "btn-danger" };

type TxButtonProps = {
  state: TxState;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  /** Keeps the button busy with this label after the flow is done, e.g. while the next page opens. */
  busyLabel?: string;
  children: ReactNode;
};

/** Button that shows the tx stage while busy. Pair with <TxStatus> for the inline result and links. */
export function TxButton({ state, onClick, disabled, variant = "primary", busyLabel, children }: TxButtonProps) {
  const busy = busyLabel ?? BUSY_LABEL[state.status];
  return (
    <button type="button" className={`${VARIANT[variant]} min-w-40`} disabled={disabled || !!busy} aria-busy={!!busy} onClick={onClick}>
      {busy && <Spinner />}
      {busy ?? children}
    </button>
  );
}

export function TxStatus({ state, success }: { state: TxState; success?: ReactNode }) {
  if (state.status === "error") {
    // The same failure also appears as a toast; this stays beside the button as the record.
    return (
      <Alert tone={toneOf(state)} title={state.title} details={state.details} actions={state.hash && <TxLink hash={state.hash} />}>
        {state.message}
      </Alert>
    );
  }
  const note = STAGE_NOTE[state.status];
  if (note) {
    const hash = state.status === "pending" || state.status === "syncing" ? state.hash : undefined;
    return (
      <p role="status" className="flex items-start gap-2 text-sm text-muted">
        <span className="mt-0.5">
          <Spinner />
        </span>
        <span>
          {note} {hash && <TxLink hash={hash} />}
        </span>
      </p>
    );
  }
  if (state.status === "confirmed") {
    return (
      <p className="text-sm text-mint">
        {success ?? "Confirmed."} <TxLink hash={state.hash} />
      </p>
    );
  }
  return null;
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2 hover:text-accent">
      View transaction ↗
    </a>
  );
}
