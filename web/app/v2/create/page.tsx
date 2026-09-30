"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress, parseEventLogs, zeroAddress, type Address } from "viem";
import { useConnection } from "wagmi";
import { AssetEditor } from "@/components/AssetEditor";
import { EmptyState, PageHeader, RequireWallet } from "@/components/Page";
import { TxButton, TxStatus } from "@/components/Tx";
import { useAssetApprovals } from "@/hooks/useAssetApprovals";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useTxFlow } from "@/hooks/useTxFlow";
import { draftToAssets, draftTokens, newRow, overlapError, type DraftRow } from "@/lib/assetDraft";
import { toRawAsset } from "@/lib/assets";
import { swapV2, swapV2Abi } from "@/lib/contracts";

type Expiry = "1h" | "24h" | "7d" | "none";
const DURATIONS: Record<Exclude<Expiry, "none">, number> = { "1h": 3600, "24h": 86400, "7d": 604800 };

export default function CreateV2Page() {
  return (
    <>
      <PageHeader title="Create a trade" />
      {!swapV2 ? (
        <EmptyState>Multi-asset trades aren&apos;t enabled on this deployment yet.</EmptyState>
      ) : (
        <RequireWallet reason="Connect a wallet to create a trade.">
          <CreateTradeV2 />
        </RequireWallet>
      )}
    </>
  );
}

function CreateTradeV2() {
  const { address } = useConnection();
  const router = useRouter();
  const approval = useTxFlow();
  const tx = useTxFlow();

  const [offeredRows, setOfferedRows] = useState<DraftRow[]>(() => [newRow("erc721")]);
  const [requestedRows, setRequestedRows] = useState<DraftRow[]>(() => [newRow("native")]);
  const [takerText, setTakerText] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("24h");
  const [validation, setValidation] = useState<string | null>(null);

  // Decimals and symbols come from the token contracts, for both sides at once.
  const tokens = useMemo(() => draftTokens([...offeredRows, ...requestedRows]), [offeredRows, requestedRows]);
  const { info } = useTokenInfo(tokens);
  const decimalsOf = (token: Address) => info.get(token.toLowerCase())?.decimals;

  const offered = draftToAssets(offeredRows, decimalsOf);
  const requested = draftToAssets(requestedRows, decimalsOf);
  const problems = [...offered.errors.map((e) => `You offer — ${e}`), ...requested.errors.map((e) => `You request — ${e}`)];
  const overlap = problems.length === 0 ? overlapError(offered.assets, requested.assets) : null;

  const { steps } = useAssetApprovals(address, offered.assets, info);
  const nextApproval = problems.length === 0 ? steps[0] : undefined;

  async function create() {
    if (!address || !swapV2) return;
    const taker = takerText.trim();
    if (problems.length > 0) return setValidation(problems[0]);
    if (overlap) return setValidation(overlap);
    if (taker && !isAddress(taker)) return setValidation("Enter a valid wallet address, or leave it empty.");
    if (taker.toLowerCase() === address.toLowerCase()) return setValidation("You cannot make a private offer to yourself.");
    setValidation(null);

    const expiryValue = expiry === "none" ? 0n : BigInt(Math.floor(Date.now() / 1000) + DURATIONS[expiry]);
    const native = offered.assets.find((a) => a.kind === "native")?.amount ?? 0n;
    const receipt = await tx.run({
      ...swapV2,
      functionName: "createTrade",
      args: [offered.assets.map(toRawAsset), requested.assets.map(toRawAsset), (taker || zeroAddress) as Address, expiryValue],
      value: native,
    });
    if (!receipt) return;
    const id = parseEventLogs({ abi: swapV2Abi, eventName: "TradeCreated", logs: receipt.logs })[0]?.args.tradeId;
    if (id !== undefined) router.push(`/v2/trade/${id.toString()}`);
  }

  return (
    <div className="space-y-8">
      <AssetEditor
        title="You offer"
        hint="Locked in escrow until someone accepts, or until you cancel."
        rows={offeredRows}
        onChange={setOfferedRows}
        info={info}
      />
      <AssetEditor
        title="You request"
        hint="Sent straight to you when someone accepts. Nothing is held for this side."
        rows={requestedRows}
        onChange={setRequestedRows}
        info={info}
      />

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="taker">Only this wallet can accept (optional)</label>
          <input id="taker" className="input font-mono" placeholder="0x…" value={takerText} onChange={(e) => setTakerText(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="expiry">Expiry</label>
          <select id="expiry" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)}>
            <option value="1h">1 hour</option>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="none">Never</option>
          </select>
        </div>
      </section>

      <div className="card space-y-3 p-4">
        <p className="text-sm text-muted">
          On Deal locks what you offer in escrow. Tokens that take a fee on transfer, or change balances on their own,
          aren&apos;t supported and the trade will be refused.
        </p>
        {(validation ?? overlap) && <p className="text-sm text-danger" role="alert">{validation ?? overlap}</p>}
        {problems.length > 0 && !validation && <p className="text-xs text-muted">{problems[0]}</p>}
        {nextApproval ? (
          <TxButton state={approval.state} onClick={() => approval.run(nextApproval.call)}>
            {nextApproval.label}
            {steps.length > 1 ? ` (1 of ${steps.length})` : ""}
          </TxButton>
        ) : (
          <TxButton state={tx.state} disabled={problems.length > 0 || !!overlap} onClick={create}>Create trade</TxButton>
        )}
        <TxStatus state={approval.state} success="Approved." />
        <TxStatus state={tx.state} success="Trade created." />
      </div>
    </div>
  );
}
