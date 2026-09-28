"use client";

import type { ReactNode } from "react";
import { explorerTx } from "@/lib/config";
import type { TxState } from "@/hooks/useTxFlow";

const BUSY_LABEL: Partial<Record<TxState["status"], string>> = {
  "switching-chain": "Switching network…",
  simulating: "Checking…",
  "awaiting-signature": "Confirm in wallet…",
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

/** Button that shows the tx stage while busy. Pair with <TxStatus> for errors and links. */
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
    return (
      <p className="text-sm text-danger" role="alert">
        {state.message} {state.hash && <TxLink hash={state.hash} />}
      </p>
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
