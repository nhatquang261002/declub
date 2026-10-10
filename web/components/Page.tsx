"use client";

import type { ReactNode } from "react";
import { useConnection } from "wagmi";
import { ConnectButton } from "./ConnectButton";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      {children}
    </div>
  );
}

/** Renders children only when a wallet is connected; until then `preview` (what the page is for) and a way to connect. */
export function RequireWallet({ children, reason, preview }: { children: ReactNode; reason: string; preview?: ReactNode }) {
  const { status } = useConnection();
  if (status === "connected") return <>{children}</>;
  if (status === "reconnecting" || status === "connecting") {
    return <p className="text-sm text-muted">Connecting wallet…</p>;
  }
  return (
    <div className="page-section flex flex-col items-center gap-4 px-6 py-12 text-center">
      {preview}
      <p className="text-muted">{reason}</p>
      <ConnectButton />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="page-section px-6 py-12 text-center text-sm text-muted">{children}</div>;
}
