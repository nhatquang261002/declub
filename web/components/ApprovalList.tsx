"use client";

import { maxUint256 } from "viem";
import { CopyAddress } from "@/components/CopyAddress";
import { TrustChip } from "@/components/TrustChip";
import { TxButton, TxStatus } from "@/components/Tx";
import { useCollectionInfos } from "@/hooks/useCollection";
import { revokeCall, type LiveApproval, type Spender } from "@/hooks/useApprovals";
import { useTxFlow } from "@/hooks/useTxFlow";
import { trustOf } from "@/lib/assetTrust";
import { LockIcon, SwapIcon } from "@/components/Icons";
import { erc20Asset, formatAsset, type TokenInfo } from "@/lib/assets";
import { collectionLabel, type CollectionInfo } from "@/lib/collections";
import { registry } from "@/lib/verifiedAssets";

const SPENDER_TEXT: Record<Spender, string> = { escrow: "Deals", intents: "Signed swaps" };

/**
 * Approvals that are still on, each with a button that turns it off. `needed` marks the ones a
 * live signed swap relies on: revoking those stops the swap settling until it's approved again.
 */
export function ApprovalList({
  approvals,
  info,
  needed = new Set(),
}: {
  approvals: readonly LiveApproval[];
  info: ReadonlyMap<string, TokenInfo>;
  /** `${spender}:${token}` (lowercase) of approvals something live still needs. */
  needed?: ReadonlySet<string>;
}) {
  const collections = approvals.filter((a) => a.kind === "erc721").map((a) => a.token);
  const { infos } = useCollectionInfos(collections);
  return (
    <ul className="space-y-2">
      {approvals.map((a) => (
        <li key={`${a.spender}:${a.kind}:${a.token}`}>
          <ApprovalRow approval={a} info={info} collection={infos.get(a.token.toLowerCase())} needed={needed.has(`${a.spender}:${a.token.toLowerCase()}`)} />
        </li>
      ))}
    </ul>
  );
}

function ApprovalRow({
  approval: a,
  info,
  collection,
  needed,
}: {
  approval: LiveApproval;
  info: ReadonlyMap<string, TokenInfo>;
  collection: CollectionInfo | undefined;
  needed: boolean;
}) {
  const revoke = useTxFlow();
  const token = info.get(a.token.toLowerCase());
  const listed = registry.entry(a.token);
  const name = a.kind === "erc721" ? collectionLabel(collection, listed?.name ?? "NFT collection") : (token?.symbol ?? listed?.symbol ?? "Token");
  const trust = trustOf(a.token, a.kind === "erc721" ? { name: collection?.name, symbol: collection?.symbol } : { symbol: token?.symbol });
  const scope =
    a.kind === "erc721"
      ? "Every NFT you hold in it"
      : a.amount !== undefined && a.amount >= maxUint256 / 2n
        ? "Any amount"
        : `Up to ${formatAsset(erc20Asset(a.token, a.amount ?? 0n), token)}`;

  return (
    <div className="page-section space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 font-bold">
            <span className="truncate">{name}</span>
            <TrustChip trust={trust} />
            <span className="chip">
              {a.spender === "escrow" ? <LockIcon /> : <SwapIcon />}
              {SPENDER_TEXT[a.spender]}
            </span>
          </p>
          <p className="text-xs text-muted">
            {scope} · <CopyAddress address={a.token} className="font-mono" />
          </p>
        </div>
        <TxButton state={revoke.state} variant="secondary" onClick={() => revoke.run(revokeCall(a))}>
          Revoke
        </TxButton>
      </div>
      {needed && <p className="text-xs text-warn">A signed swap of yours in the pool needs this. It can&apos;t settle while it&apos;s off.</p>}
      <TxStatus state={revoke.state} success="Revoked." />
    </div>
  );
}
