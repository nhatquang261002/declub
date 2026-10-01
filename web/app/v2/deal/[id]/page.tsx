"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { useConnection, useReadContracts } from "wagmi";
import { AssetList } from "@/components/AssetList";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState, PageHeader } from "@/components/Page";
import { describeError } from "@/lib/errors";
import { TraitSlotView } from "@/components/TraitFillPanel";
import { OfferNote, ProposalForm, ProposalList } from "@/components/Proposals";
import { StatusBadge } from "@/components/DealParts";
import { TxButton, TxStatus } from "@/components/Tx";
import { useAssetApprovals } from "@/hooks/useAssetApprovals";
import { useLocalFills } from "@/hooks/useLocalFills";
import { useNow } from "@/hooks/useNow";
import { useProposalsV2 } from "@/hooks/useProposalsV2";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useTraitFill } from "@/hooks/useTraitFill";
import { useDealV2 } from "@/hooks/useDealV2";
import { useTxFlow } from "@/hooks/useTxFlow";
import { ASSET_TYPE, erc20Tokens, formatAsset, sameAsset, type Asset } from "@/lib/assets";
import { swapV2 } from "@/lib/contracts";
import { formatDate } from "@/lib/format";
import { isOpenOffer } from "@/lib/dealsV2";
import { displayStatus, sameAddress } from "@/lib/deals";

const NO_ASSETS: readonly Asset[] = [];

export default function DealV2Page() {
  const params = useParams<{ id: string }>();
  if (!swapV2) return <EmptyState>Multi-asset deals aren&apos;t enabled on this deployment yet.</EmptyState>;
  if (!/^\d+$/.test(params.id)) return <EmptyState>Invalid deal id.</EmptyState>;
  return <DealDetailV2 id={BigInt(params.id)} />;
}

function DealDetailV2({ id }: { id: bigint }) {
  const { address } = useConnection();
  const { deal, note, traitClauses, isLoading, error } = useDealV2(id);
  const now = useNow();
  const action = useTxFlow();
  const claim = useTxFlow();
  // History can't see who filled a public deal without an indexer, so remember this browser's fills.
  const { record } = useLocalFills(address, swapV2!.address);

  // An open offer has no ask: takers send proposals and the maker picks one (ADR 0007).
  const openOffer = !!deal && isOpenOffer(deal);
  const { proposals, total, hasMore, loadMore } = useProposalsV2(id, openOffer);

  const assets = useMemo(
    () => [...(deal?.offered ?? []), ...(deal?.requested ?? []), ...proposals.flatMap((p) => p.assets)],
    [deal, proposals],
  );
  const tokens = useMemo(() => erc20Tokens(assets), [assets]);
  const { info } = useTokenInfo(tokens);

  const status = deal ? displayStatus(deal, now) : "open";
  const isMaker = sameAddress(deal?.maker, address);
  const allowed = !!deal && !isMaker && (!deal.taker || sameAddress(deal.taker, address));
  const canFill = status === "open" && allowed && !!address && !openOffer;
  const canPropose = status === "open" && allowed && !!address && openOffer;

  // The wallet whose offer was accepted is the taker. Remember it, like a fill, for History.
  const acceptedMine = proposals.some((p) => p.status === "accepted" && sameAddress(p.proposer, address));
  useEffect(() => {
    if (acceptedMine) record(id);
  }, [acceptedMine, record, id]);

  // Trait requests: the maker's description is checked against the deal's Merkle root before a
  // taker is offered a fill (hooks/useTraitFill.ts).
  const traitFill = useTraitFill(deal?.requested ?? NO_ASSETS, traitClauses);

  // What the taker must approve before filling. Only asked for once they could actually fill.
  const { steps } = useAssetApprovals(canFill ? address : undefined, deal?.requested ?? [], info);

  // A rejected payout can come from the deal itself, or from the offer that settled it or that
  // this wallet made. Reading claimable() for every other wallet's offers would be wasted calls.
  const creditAssets = useMemo(
    () => [
      ...(deal?.offered ?? []),
      ...(deal?.requested ?? []),
      ...proposals
        .filter((p) => p.status === "accepted" || sameAddress(p.proposer, address))
        .flatMap((p) => p.assets),
    ],
    [deal, proposals, address],
  );
  const credits = useCredits(address, creditAssets);

  if (isLoading) return <EmptyState>Loading deal…</EmptyState>;
  if (!deal && error && describeError(error).kind !== "reverted") {
    return <LoadError title="Couldn&apos;t load this deal" error={error} />;
  }
  if (!deal) return <EmptyState>This deal does not exist.</EmptyState>;

  const requestedNative = deal.requested.find((a) => a.kind === "native")?.amount ?? 0n;
  const plainRequested = deal.requested.filter((a) => a.kind !== "trait");
  const traitFillBlocked = traitFill.hasTraits && !traitFill.complete;

  return (
    <>
      <PageHeader title={`Deal #${id.toString()}`}>
        <StatusBadge status={status} />
      </PageHeader>
      <div className="space-y-6">
        <div className="card grid gap-6 p-5 md:grid-cols-2">
          <div>
            <div className="label">Maker gives</div>
            <AssetList assets={deal.offered} info={info} />
          </div>
          {openOffer ? (
            <div className="space-y-2">
              <div className="label">Open to offers</div>
              <OfferNote note={note} />
            </div>
          ) : (
            <div>
              <div className="label">Taker gives</div>
              <div className="space-y-2">
                {traitFill.hasTraits && !traitFill.aligned && (
                  <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-warn">
                    This deal asks for NFTs by trait, but its description can&apos;t be read here, so it can&apos;t be accepted from this app.
                  </p>
                )}
                {traitFill.slots.map((slot, i) => (
                  <TraitSlotView
                    key={slot.asset.id.toString()}
                    slot={slot}
                    account={address}
                    onToggle={canFill ? (tokenId) => traitFill.toggle(i, tokenId) : undefined}
                  />
                ))}
                {plainRequested.length > 0 && <AssetList assets={plainRequested} info={info} />}
              </div>
            </div>
          )}
          <div className="text-sm text-muted">Created by <span className="font-mono">{deal.maker}</span></div>
          <div className="text-sm text-muted">
            {deal.expiry === 0n ? "No expiry" : `Expires ${formatDate(deal.expiry)}`}
            {deal.taker && <> · private offer for <span className="font-mono">{deal.taker}</span></>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {status === "open" && isMaker && (
            <TxButton state={action.state} variant="danger" onClick={() => action.run({ ...swapV2!, functionName: "cancelTrade", args: [id] })}>
              Cancel deal
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
            <TxButton
              state={action.state}
              disabled={traitFillBlocked}
              onClick={async () => {
                const receipt = traitFill.hasTraits
                  ? traitFill.fills && (await action.run({ ...swapV2!, functionName: "fillTraitTrade", args: [id, traitFill.fills], value: requestedNative }))
                  : await action.run({ ...swapV2!, functionName: "fillTrade", args: [id], value: requestedNative });
                if (receipt) record(id);
              }}
            >
              Accept &amp; swap
            </TxButton>
          )}
          {status === "open" && !isMaker && !allowed && (
            <p className="text-sm text-muted">This is a private offer for another wallet.</p>
          )}
          {status === "open" && !address && (
            <p className="text-sm text-muted">Connect a wallet to {openOffer ? "send an offer" : "accept this deal"}.</p>
          )}
          {(status === "filled" || status === "cancelled") && (
            <p className="text-sm text-muted">
              This deal is settled and read-only.
              {openOffer && " Offers that weren't accepted can still be withdrawn by whoever made them."}
            </p>
          )}
          <Link href="/deals" className="btn-secondary">Back to deals</Link>
        </div>
        <TxStatus state={action.state} />

        {openOffer && (
          <ProposalList
            proposals={proposals}
            total={total}
            hasMore={hasMore}
            onLoadMore={loadMore}
            info={info}
            dealId={id}
            canDecide={isMaker && status === "open"}
          />
        )}
        {canPropose && <ProposalForm dealId={id} offered={deal.offered} />}

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

/** Amounts ChogSwapV2 is holding for `account` from this deal's assets (rejected payouts). */
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
