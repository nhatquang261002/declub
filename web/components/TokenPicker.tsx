"use client";

import { useEffect, useRef } from "react";
import type { Address } from "viem";
import { Alert } from "@/components/Alert";
import { AssetSearch } from "@/components/AssetSearch";
import { CopyAddress } from "@/components/CopyAddress";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { registry } from "@/lib/verifiedAssets";

type Props = {
  /** The wallet giving the tokens: the search starts on what it holds. Omit on the "you want" side. */
  owner?: Address;
  onSelect: (token: Address) => void;
  onClose: () => void;
};

/**
 * Pick an ERC-20 without copying its address: search by name or symbol, with the wallet's holdings
 * first (ADR 0027). A pasted address is read from its contract before it can be used, and the
 * address stays on every row, since a name can be anything.
 */
export function TokenPicker({ owner, onSelect, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a token"
        className="page-section flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto p-5 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Choose a token</h2>
            <p className="mt-1 text-xs text-muted">
              {owner ? "Pick from what you hold, or search everything." : "Search for the token you want."} Names come from the token, so check the address.
            </p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <AssetSearch
          kind="erc20"
          owner={owner}
          label="Search tokens, or paste a contract address"
          onSelect={(hit) => onSelect(hit.address)}
          renderPasted={(address) => <PastedToken address={address} onSelect={onSelect} />}
        />
      </div>
    </div>
  );
}

/** A pasted address, read from its contract before it can be chosen. */
function PastedToken({ address, onSelect }: { address: Address; onSelect: (token: Address) => void }) {
  const { info, isLoading } = useTokenInfo([address]);
  const known = info.get(address.toLowerCase());
  if (isLoading) return <p className="text-sm text-muted">Reading the contract…</p>;
  if (!known) {
    return (
      <Alert tone="danger" title="Not a token">
        <CopyAddress address={address} /> doesn&apos;t answer as an ERC-20 token. Check the address and the network.
      </Alert>
    );
  }
  const tier = registry.tier(address);
  return (
    <button
      type="button"
      onClick={() => onSelect(address)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border-[1.5px] border-[#111318]/20 bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-[#111318] hover:bg-white"
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{known.symbol}</span>
        <CopyAddress address={address} inLink className="block text-xs text-muted" />
      </span>
      <span className="shrink-0 text-xs text-muted">{known.decimals} decimals{tier === "verified" ? " · Verified" : ""}</span>
    </button>
  );
}
