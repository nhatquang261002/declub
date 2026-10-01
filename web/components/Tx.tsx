"use client";

import type { ReactNode } from "react";
import { explorerTx } from "@/lib/config";
import type { TxState } from "@/hooks/useTxFlow";
import { Alert, toneOf } from "./Alert";

const BUSY_LABEL: Partial<Record<TxState["status"], string>> = {
  "switching-chain": "Switching network…",
  simulating: "Checking…",
  "awaiting-signature": "Confirm in wallet…",
  posting: "Sending to the pool…",
  pending: "Waiting for block…",
};

// Literal class names so Tailwind's scanner picks them up.
const VARIANT = { primary: "btn-primary", secondary: "btn-secondary", danger: "btn-danger" };

type TxButtonProps = {
  state: TxState;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  children: ReactNode;
};

/** Button that shows the tx stage while busy. Pair with <TxStatus> for the inline result and links. */
export function TxButton({ state, onClick, disabled, variant = "primary", children }: TxButtonProps) {
  const busy = BUSY_LABEL[state.status];
  return (
    <button
      type="button"
      className={`${VARIANT[variant]} min-w-40`}
      disabled={disabled || !!busy}
      onClick={onClick}
    >
      {busy && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {busy ?? children}
    </button>
  );
}

export function TxStatus({ state, success }: { state: TxState; success?: ReactNode }) {
  if (state.status === "error") {
    // The same failure also appears as a toast; this stays beside the button as the record.
    return (
      <Alert
        tone={toneOf(state)}
        title={state.title}
        details={state.details}
        actions={state.hash && <TxLink hash={state.hash} />}
      >
        {state.message}
      </Alert>
    );
  }
  if (state.status === "pending") {
    return (
      <p className="text-sm text-muted">
        Submitted. <TxLink hash={state.hash} />
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
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="underline hover:text-white">
      View transaction ↗
    </a>
  );
}
