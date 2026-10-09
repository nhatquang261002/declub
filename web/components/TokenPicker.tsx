"use client";

import type { Address } from "viem";
import { Alert } from "@/components/Alert";
import { AssetSearch } from "@/components/AssetSearch";
import { CopyAddress } from "@/components/CopyAddress";
import { PickerDialog } from "@/components/PickerDialog";
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
  return (
    <PickerDialog
      label="Choose a token"
      title="Choose a token"
      hint={<>{owner ? "Pick from what you hold, or search everything." : "Search for the token you want."} Names come from the token, so check the address.</>}
      onClose={onClose}
    >
      <AssetSearch
        kind="erc20"
        owner={owner}
        label="Search tokens, or paste a contract address"
        onSelect={(hit) => onSelect(hit.address)}
        renderPasted={(address) => <PastedToken address={address} onSelect={onSelect} />}
      />
    </PickerDialog>
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
      <span className="shrink-0 text-xs text-muted">
        {known.decimals} decimals{tier === "verified" ? " · Verified" : ""}
      </span>
    </button>
  );
}
