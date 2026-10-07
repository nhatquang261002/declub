"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection } from "wagmi";
import type { Hash } from "viem";
import { CrossIcon } from "@/components/Icons";
import { TxButton, TxStatus } from "@/components/Tx";
import { useSponsorFlow, useSponsorInfo } from "@/hooks/useSponsorFlow";
import { formatMon, parseMon } from "@/lib/format";
import { REWARDS, SPONSOR_MIN_WEI, SPONSOR_NAME_MAX } from "@/lib/rewards";

/**
 * "Sponsor this epoch" (ADR 0036): pay MON to the rewards operator, who puts it in this Club's
 * Holder pool for the epoch. The payment is read off the chain and put under a name only the
 * paying wallet can sign. A dialog, opened from the Sponsor button in the Rewards tab's header: it
 * can't be dismissed while a payment is in flight, so the flow isn't lost half way.
 */
export function SponsorEpoch({ token, symbol, isOwner, onClose }: { token: string; symbol: string; isOwner: boolean; onClose: () => void }) {
  const { info } = useSponsorInfo(token);
  const { address } = useConnection();
  const flow = useSponsorFlow(token);
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [paid, setPaid] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const busy = flow.busy;

  useEffect(() => {
    const previous = document.body.style.overflow;
    const opener = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, []);
  // Focus the amount once the form is there (it waits for the operator address).
  const ready0 = !!info?.enabled && !!info.to;
  useEffect(() => {
    if (ready0) first.current?.focus();
  }, [ready0]);

  if (!info?.enabled || !info.to) return null;

  const wei = parseMon(amount);
  const min = BigInt(info.min ?? SPONSOR_MIN_WEI);
  const cleanName = name.replace(/\s+/g, " ").trim();
  const ready = !!address && wei !== null && wei >= min && cleanName.length > 0;
  const hint = !address ? "Connect a wallet to sponsor." : wei !== null && wei > 0n && wei < min ? `The least is ${formatMon(min)}.` : null;
  const pendingHash = flow.unrecorded && flow.state.status === "error" ? flow.unrecorded : null;
  const manualHash = /^0x[0-9a-fA-F]{64}$/.test(paid.trim()) ? (paid.trim() as Hash) : null;

  const close = () => {
    if (!busy) onClose();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      const items = [...(panel.current?.querySelectorAll<HTMLElement>("button, input, summary, a[href]") ?? [])].filter(
        (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Sponsor this epoch"
        className="page-section flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col gap-1 overflow-auto p-5"
        onKeyDown={onKeyDown}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight">Sponsor this epoch</h2>
          <button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={close}>
            <CrossIcon />
          </button>
        </div>
        <p className="text-sm">
          Add MON to {symbol}’s Holder pool for epoch {info.epoch}. It goes to the {REWARDS.maxHolders} most active Holders on top of the swap fees, split the same way, and none of it
          goes to the protocol.
          {isOwner ? " As the Owner, it shows as your Club’s own top-up." : " Your name shows on the Club’s Rewards tab and in its weekly recap."} The MON is sent to the rewards
          operator, who funds the epoch with it; it can’t be refunded.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr]">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Amount (MON)
            <input
              ref={first}
              className="input border-2 border-[#111318]/25 bg-white focus:border-[#111318]"
              inputMode="decimal"
              placeholder={formatMon(min).replace(" MON", "")}
              value={amount}
              disabled={flow.busy}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Shown as
            <input
              className="input border-2 border-[#111318]/25 bg-white focus:border-[#111318]"
              placeholder={isOwner ? "Your Club or team name" : "Your name or project"}
              maxLength={SPONSOR_NAME_MAX}
              value={name}
              disabled={flow.busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <TxButton
            state={flow.state}
            disabled={!ready}
            onClick={async () => {
              if (wei === null || !info.to) return;
              const done = await flow.run(info.to, wei, cleanName);
              if (done) setAmount("");
            }}
          >
            Sponsor
          </TxButton>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <div className="mt-3">
          <TxStatus
            state={flow.state}
            success={
              flow.recorded
                ? `Thank you. ${formatMon(BigInt(flow.recorded.amount))} was added to epoch ${flow.recorded.epoch}${flow.recorded.epoch !== info.epoch ? " (the one after, because this one is already built)" : ""}.`
                : undefined
            }
          />
        </div>
        {pendingHash && (
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            Your payment went through but wasn’t recorded.
            <button type="button" className="btn-secondary" disabled={flow.busy} onClick={() => void flow.retry(pendingHash.hash, pendingHash.name)}>
              Finish recording
            </button>
          </p>
        )}
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer font-semibold">Already paid the operator?</summary>
          <p className="mt-2">
            Paste the transaction hash of a payment to <span className="break-all font-mono">{info.to}</span> from the connected wallet, and sign to record it. A payment is
            recorded once.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="input min-w-0 flex-1 border-2 border-[#111318]/25 bg-white font-mono" placeholder="0x…" value={paid} onChange={(e) => setPaid(e.target.value)} />
            <button
              type="button"
              className="btn-secondary"
              disabled={flow.busy || !manualHash || !address || cleanName.length === 0}
              onClick={() => manualHash && void flow.retry(manualHash, cleanName)}
            >
              Record it
            </button>
          </div>
          {cleanName.length === 0 && <p className="mt-1">Fill in “Shown as” above first.</p>}
        </details>
      </div>
    </div>,
    document.body,
  );
}
