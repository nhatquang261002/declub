"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useConnection, useReadContracts } from "wagmi";
import { AssetList } from "@/components/AssetList";
import { EmptyState, PageHeader } from "@/components/Page";
import { StatusBadge } from "@/components/TradeParts";
import { TxButton, TxStatus } from "@/components/Tx";
import { useAssetApprovals } from "@/hooks/useAssetApprovals";
import { useNow } from "@/hooks/useNow";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useTradeV2 } from "@/hooks/useTradeV2";
import { useTxFlow } from "@/hooks/useTxFlow";
import { ASSET_TYPE, erc20Tokens, formatAsset, sameAsset, type Asset } from "@/lib/assets";
import { swapV2 } from "@/lib/contracts";
import { formatDate } from "@/lib/format";
import { displayStatus, sameAddress } from "@/lib/trades";

export default function TradeV2Page() {
  const params = useParams<{ id: string }>();
  if (!swapV2) return <EmptyState>Multi-asset trades aren&apos;t enabled on this deployment yet.</EmptyState>;
  if (!/^\d+$/.test(params.id)) return <EmptyState>Invalid trade id.</EmptyState>;
  return <TradeDetailV2 id={BigInt(params.id)} />;
}

function TradeDetailV2({ id }: { id: bigint }) {
  const { address } = useConnection();
  const { trade, isLoading } = useTradeV2(id);
  const now = useNow();
  const action = useTxFlow();
  const claim = useTxFlow();

  const assets = useMemo(() => [...(trade?.offered ?? []), ...(trade?.requested ?? [])], [trade]);
  const tokens = useMemo(() => erc20Tokens(assets), [assets]);
  const { info } = useTokenInfo(tokens);

  const status = trade ? displayStatus(trade, now) : "open";
  const isMaker = sameAddress(trade?.maker, address);
  const allowed = !!trade && !isMaker && (!trade.taker || sameAddress(trade.taker, address));
  const canFill = status === "open" && allowed && !!address;

  // What the taker must approve before filling. Only asked for once they could actually fill.
  const { steps } = useAssetApprovals(canFill ? address : undefined, trade?.requested ?? [], info);

  const credits = useCredits(address, assets);

  if (isLoading) return <EmptyState>Loading trade…</EmptyState>;
  if (!trade) return <EmptyState>This trade does not exist.</EmptyState>;

  const requestedNative = trade.requested.find((a) => a.kind === "native")?.amount ?? 0n;

  return (
    <>
      <PageHeader title={`Trade #${id.toString()}`}>
        <StatusBadge status={status} />
      </PageHeader>
      <div className="space-y-6">
        <div className="card grid gap-6 p-5 md:grid-cols-2">
          <div>
            <div className="label">Maker gives</div>
            <AssetList assets={trade.offered} info={info} />
          </div>
          <div>
            <div className="label">Taker gives</div>
            <AssetList assets={trade.requested} info={info} />
          </div>
          <div className="text-sm text-muted">Created by <span className="font-mono">{trade.maker}</span></div>
          <div className="text-sm text-muted">
            {trade.expiry === 0n ? "No expiry" : `Expires ${formatDate(trade.expiry)}`}
            {trade.taker && <> · private offer for <span className="font-mono">{trade.taker}</span></>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {status === "open" && isMaker && (
            <TxButton state={action.state} variant="danger" onClick={() => action.run({ ...swapV2!, functionName: "cancelTrade", args: [id] })}>
              Cancel trade
            </TxButton>
          )}
          {status === "expired" && (
            <TxButton state={action.state} onClick={() => action.run({ ...swapV2!, functionName: "reclaimExpired", args: [id] })}>
              Reclaim to maker
            </TxButton>
          )}
          {canFill && steps[0] && (
            <TxButton state={action.state} onClick={() => action.run(steps[0].call)}>
              {steps[0].label}
              {steps.length > 1 ? ` (1 of ${steps.length})` : ""}
            </TxButton>
          )}
          {canFill && !steps[0] && (
            <TxButton state={action.state} onClick={() => action.run({ ...swapV2!, functionName: "fillTrade", args: [id], value: requestedNative })}>
              Accept &amp; swap
            </TxButton>
          )}
          {status === "open" && !isMaker && !allowed && (
            <p className="text-sm text-muted">This is a private offer for another wallet.</p>
          )}
          {status === "open" && !address && <p className="text-sm text-muted">Connect a wallet to accept this trade.</p>}
          {(status === "filled" || status === "cancelled") && <p className="text-sm text-muted">This trade is settled and read-only.</p>}
          <Link href="/trades" className="btn-secondary">Back to trades</Link>
        </div>
        <TxStatus state={action.state} />

        {credits.length > 0 && (
          <div className="card space-y-3 p-5">
            <div className="label">Waiting for you to collect</div>
            <p className="text-sm text-muted">
              A payout to you was rejected (for example by a token or a contract wallet). It is held safely until you claim it.
            </p>
            {credits.map(({ asset, amount }) => (
              <div key={`${asset.kind}:${asset.token}:${asset.id}`} className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-semibold">
                  {asset.kind === "erc721" ? `NFT #${asset.id}` : formatAsset({ ...asset, amount }, info.get(asset.token.toLowerCase()))}
                </span>
                <TxButton
                  state={claim.state}
                  onClick={() => claim.run({ ...swapV2!, functionName: "claim", args: [ASSET_TYPE[asset.kind], asset.token, asset.id] })}
                >
                  Claim
                </TxButton>
              </div>
            ))}
            <TxStatus state={claim.state} success="Claimed." />
          </div>
        )}
      </div>
    </>
  );
}

/** Amounts ChogSwapV2 is holding for `account` from this trade's assets (rejected payouts). */
function useCredits(account: `0x${string}` | undefined, assets: readonly Asset[]) {
  const unique = useMemo(() => {
    const out: Asset[] = [];
    for (const a of assets) if (!out.some((b) => sameAsset(a, b))) out.push(a);
    return out;
  }, [assets]);

  const result = useReadContracts({
    contracts: unique.map(
      (a) =>
        ({
          ...swapV2!,
          functionName: "claimable",
          args: [account!, ASSET_TYPE[a.kind], a.token, a.id],
        }) as const,
    ),
    query: { enabled: !!account && !!swapV2 && unique.length > 0, refetchInterval: 8_000 },
  });

  return useMemo(
    () =>
      unique.flatMap((asset, i) => {
        const read = result.data?.[i];
        return read?.status === "success" && read.result > 0n ? [{ asset, amount: read.result }] : [];
      }),
    [unique, result.data],
  );
}
