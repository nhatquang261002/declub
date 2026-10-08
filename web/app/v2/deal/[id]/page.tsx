"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useConnection, useReadContracts } from "wagmi";
import { Alert } from "@/components/Alert";
import { AssetList } from "@/components/AssetList";
import { ConnectButton } from "@/components/ConnectButton";
import { FeeNote } from "@/components/FeeNote";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState } from "@/components/Page";
import { describeError } from "@/lib/errors";
import { TraitSlotView } from "@/components/TraitFillPanel";
import { OfferNote, ProposalForm, ProposalList } from "@/components/Proposals";
import { SettlementTag, STATUS_TEXT } from "@/components/DealParts";
import {
  BackToDeals,
  DealByline,
  DealDock,
  DealFacts,
  DealSheet,
  DealSheetHead,
  DealStage,
  DealStageSide,
  DealStamp,
  DealSteps,
  DealTitle,
  sideTitles,
  stepsOf,
  type Party,
} from "@/components/DealSheet";
import { ExternalIcon, LockIcon } from "@/components/Icons";
import { TxButton, TxStatus } from "@/components/Tx";
import { TrustCheck } from "@/components/TrustCheck";
import { ApprovalList } from "@/components/ApprovalList";
import { useApprovals, type ApprovalTarget } from "@/hooks/useApprovals";
import { useAssetTrust } from "@/hooks/useAssetTrust";
import { allVerified, sideTrust } from "@/lib/assetTrust";
import { useAssetApprovals } from "@/hooks/useAssetApprovals";
import { useFills } from "@/hooks/useFills";
import { useNow } from "@/hooks/useNow";
import { useProposalsV2 } from "@/hooks/useProposalsV2";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { useTraitFill } from "@/hooks/useTraitFill";
import { useDealV2 } from "@/hooks/useDealV2";
import { useTxFlow } from "@/hooks/useTxFlow";
import { ASSET_TYPE, erc20Tokens, feeUnits, formatAsset, nativeAsset, sameAsset, sideFee, type Asset } from "@/lib/assets";
import { swapV2 } from "@/lib/contracts";
import { DECLUB_ESCROW_ADDRESS, explorerAddress, SHOW_V2 } from "@/lib/config";
import { Who } from "@/components/Who";
import { formatDate } from "@/lib/format";
import { isOpenOffer, type DealV2 } from "@/lib/dealsV2";
import { displayStatus, sameAddress, type DisplayStatus } from "@/lib/deals";
import { CopyAddress } from "@/components/CopyAddress";
import { ShareDeal } from "@/components/ShareDeal";

const NO_ASSETS: readonly Asset[] = [];
const ESCROW_ONLY = ["escrow"] as const;

export default function DealV2Page() {
  const params = useParams<{ id: string }>();
  if (!SHOW_V2) return <EmptyState>Deals aren&apos;t enabled on this deployment yet.</EmptyState>;
  if (!/^\d+$/.test(params.id)) return <EmptyState>Invalid deal id.</EmptyState>;
  return <DealDetailV2 id={BigInt(params.id)} />;
}

function DealDetailV2({ id }: { id: bigint }) {
  const { address } = useConnection();
  const { deal, note, traitClauses, isLoading, error } = useDealV2(id);
  const now = useNow();
  const action = useTxFlow();
  const claim = useTxFlow();
  // Both sides pay the fee this deal was listed with, not the contract's current one (ADR 0018).
  const fee = deal?.fee;
  // History needs to know which public deals this wallet filled (hooks/useFills.ts).
  const { record } = useFills(address, DECLUB_ESCROW_ADDRESS);

  // An open offer has no ask: takers send proposals and the maker picks one (ADR 0007).
  const openOffer = !!deal && isOpenOffer(deal);
  const { proposals, total, hasMore, loadMore } = useProposalsV2(id, openOffer);

  const assets = useMemo(() => [...(deal?.offered ?? []), ...(deal?.requested ?? []), ...proposals.flatMap((p) => p.assets)], [deal, proposals]);
  const tokens = useMemo(() => erc20Tokens(assets), [assets]);
  const { info } = useTokenInfo(tokens);
  const trust = useAssetTrust(assets, info);
  // The taker ticks this after checking unverified contracts they'd receive (ADR 0014).
  const [checked, setChecked] = useState(false);

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
      // A protocol-fee share that couldn't be refunded is credited as MON, whatever the deal holds.
      ...(fee ? [nativeAsset(0n)] : []),
      ...(deal?.offered ?? []),
      ...(deal?.requested ?? []),
      ...proposals.filter((p) => p.status === "accepted" || sameAddress(p.proposer, address)).flatMap((p) => p.assets),
    ],
    [deal, proposals, address, fee],
  );
  const credits = useCredits(address, creditAssets);

  // The escrow only uses an approval inside the transaction that pulls the assets, so once this
  // wallet isn't about to accept or offer, whatever it approved here can be turned off.
  const approvalTargets = useMemo<ApprovalTarget[]>(
    () =>
      assets.flatMap<ApprovalTarget>((a) =>
        a.kind === "erc721" || a.kind === "trait" ? [{ token: a.token, kind: "erc721" }] : a.kind === "erc20" ? [{ token: a.token, kind: "erc20" }] : [],
      ),
    [assets],
  );
  const { approvals: leftover } = useApprovals(canFill || canPropose ? undefined : address, approvalTargets, ESCROW_ONLY);

  if (isLoading) return <EmptyState>Loading deal…</EmptyState>;
  if (!deal && error && describeError(error).kind !== "reverted") {
    return <LoadError title="Couldn't load this deal" error={error} />;
  }
  if (!deal) return <EmptyState>This deal does not exist.</EmptyState>;

  const requestedNative = deal.requested.find((a) => a.kind === "native")?.amount ?? 0n;
  const plainRequested = deal.requested.filter((a) => a.kind !== "trait");
  const traitFillBlocked = traitFill.hasTraits && !traitFill.complete;
  const forMe = !!deal.taker && sameAddress(deal.taker, address);
  // What each side is to the viewer, when they're a party to it.
  const party: Party = isMaker ? "maker" : status === "open" && allowed && !!address ? "taker" : undefined;
  const titles = sideTitles(party);
  const kind = openOffer ? "Open offer" : traitFill.hasTraits ? "Request by trait" : null;
  const settled = status === "filled" || status === "cancelled";
  // What the taker would receive, and whether anything in the deal is on the blocked list.
  const received = sideTrust(deal.offered, trust);
  const blocked = sideTrust([...deal.offered, ...deal.requested], trust).blocked.length > 0;
  const trustBlocked = blocked || (!allVerified(received) && !checked);

  async function accept() {
    if (fee === undefined) return;
    // What the maker asked for in MON, plus this wallet's share of the protocol fee: one per NFT it hands over.
    const value = requestedNative + sideFee(fee, deal!.requested);
    const receipt = traitFill.hasTraits
      ? traitFill.fills && (await action.run({ ...swapV2!, functionName: "fillTraitTrade", args: [id, traitFill.fills], value }))
      : await action.run({ ...swapV2!, functionName: "fillTrade", args: [id], value });
    if (receipt) record(id);
  }

  return (
    <>
      <BackToDeals />
      <div className="space-y-8">
        {blocked && (
          <Alert tone="danger" title="This deal includes a blocked asset">
            {isMaker
              ? "One of its assets is on DeClub's blocked list, so nobody can accept it here. You can still cancel it to take your side back."
              : "One of its assets is on DeClub's blocked list, usually a scam or a copy of a real collection, so it can't be accepted here."}
          </Alert>
        )}
        <DealSheet>
          <DealSheetHead
            chips={
              <>
                <SettlementTag signed={false} />
                {forMe && <span className="chip chip-peach">★ For you</span>}
                {isMaker && <span className="chip chip-dark">Your deal</span>}
                {kind && <span className="chip">{kind}</span>}
              </>
            }
            title={<DealTitle id={id.toString()} />}
            byline={<DealByline maker={deal.maker} mine={isMaker} expiry={deal.expiry} now={now} live={status === "open"} />}
            stamp={<DealStamp status={status} label={STATUS_TEXT[status]} note={status === "open" && openOffer ? "taking offers" : undefined} />}
          />

          <DealStage
            status={status}
            live={status === "open"}
            gives={
              <DealStageSide
                side="give"
                title={titles.give}
                note={
                  settled ? undefined : (
                    <>
                      <LockIcon /> In escrow
                    </>
                  )
                }
                mine={party === "taker"}
              >
                <AssetList assets={deal.offered} info={info} />
              </DealStageSide>
            }
            wants={
              openOffer ? (
                <DealStageSide side="want" title={isMaker ? "You're looking for" : "Maker is looking for"}>
                  <OfferNote note={note} />
                </DealStageSide>
              ) : (
                <DealStageSide side="want" title={titles.want} mine={party === "maker"}>
                  {traitFill.hasTraits && !traitFill.aligned && (
                    <Alert tone="warn" title="Can’t be accepted here">
                      This deal asks for NFTs by trait, but its description can&apos;t be read here.
                    </Alert>
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
                </DealStageSide>
              )
            }
          />

          <DealFacts
            facts={[
              {
                label: openOffer ? "Who can send offers" : "Who can accept",
                value: deal.taker ? <Who address={deal.taker} mine={forMe} /> : "Anyone",
              },
              { label: "Expires", value: deal.expiry === 0n ? "Never" : formatDate(deal.expiry) },
              // The whole address, where people are meant to check it against their counterparty.
              { label: "Maker's wallet", value: <CopyAddress address={deal.maker} full className="text-xs font-semibold" /> },
              // A deal has no address of its own: it lives in the escrow contract under its id.
              {
                label: "On-chain",
                value: (
                  <a
                    href={explorerAddress(DECLUB_ESCROW_ADDRESS!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                  >
                    View on explorer <ExternalIcon className="size-3" />
                  </a>
                ),
                hint: `Deal #${id} in the DeClub escrow contract`,
              },
            ]}
          />
        </DealSheet>

        <Dock deal={deal} status={status} isMaker={isMaker} allowed={allowed} openOffer={openOffer} canPropose={canPropose} connected={!!address}>
          {canFill && (
            <>
              <DealSteps
                steps={stepsOf([
                  ["Wallet connected", true],
                  ...(traitFill.hasTraits ? [["Choose your NFTs", traitFill.complete] as const] : []),
                  [steps.length > 1 ? `Approve ${steps.length} assets` : "Approve", steps.length === 0],
                  ["Accept & swap", false],
                ])}
              />
              <TrustCheck side={received} info={info} confirmed={checked} onConfirm={setChecked} />
              {fee !== undefined && (
                <FeeNote amount={fee} units={feeUnits(deal.requested)}>
                  Sent with your payment, once for each NFT you hand over. The maker pays the same for theirs, and neither is charged unless the swap completes.
                </FeeNote>
              )}
            </>
          )}
          {fee !== undefined && status === "open" && isMaker && (
            <FeeNote amount={fee} units={feeUnits(deal.offered)}>
              Held with your deal, once for each NFT you offer. Charged only if it completes; returned if you cancel or it expires.
            </FeeNote>
          )}

          {(status === "open" && isMaker) || status === "expired" || canFill || canPropose ? (
            <div className="flex flex-wrap items-center gap-3">
              {status === "open" && isMaker && (
                <TxButton state={action.state} variant="danger" onClick={() => action.run({ ...swapV2!, functionName: "cancelTrade", args: [id] })}>
                  Cancel deal
                </TxButton>
              )}
              {status === "expired" && (
                <TxButton state={action.state} onClick={() => action.run({ ...swapV2!, functionName: "reclaimExpired", args: [id] })}>
                  {isMaker ? "Reclaim my assets" : "Return assets to maker"}
                </TxButton>
              )}
              {canFill && steps[0] && (
                <TxButton state={action.state} disabled={trustBlocked} onClick={() => action.run(steps[0].call)}>
                  {steps[0].label}
                  {steps.length > 1 ? ` (1 of ${steps.length})` : ""}
                </TxButton>
              )}
              {canFill && !steps[0] && (
                <TxButton state={action.state} disabled={traitFillBlocked || trustBlocked || fee === undefined} onClick={accept}>
                  Accept &amp; swap
                </TxButton>
              )}
              {canPropose && (
                <a href="#make-offer" className="btn-primary">
                  Build your offer <span aria-hidden>↓</span>
                </a>
              )}
              {canFill && traitFillBlocked && !steps[0] && <p className="text-sm text-muted">Pick the NFTs you&apos;ll send, above.</p>}
            </div>
          ) : null}
          <TxStatus state={action.state} success={status === "filled" ? "Swapped. The assets are in your wallet." : undefined} />
          <ShareDeal deal={deal} info={info} now={now} />
        </Dock>

        {credits.length > 0 && (
          <section className="deal-panel space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip-mint">Held for you</span>
              <h2 className="font-black">Waiting for you to collect</h2>
            </div>
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
          </section>
        )}

        {leftover.length > 0 && (
          <section className="deal-panel space-y-3 p-5">
            <div>
              <h2 className="font-black">Approvals you can turn off</h2>
              <p className="text-sm text-muted">
                Your wallet still lets the escrow move these. It only needs that while you list or accept a deal.{" "}
                <Link href="/approvals" className="underline underline-offset-2">
                  All your approvals
                </Link>
              </p>
            </div>
            <ApprovalList approvals={leftover} info={info} />
          </section>
        )}

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
        {canPropose && (
          <div id="make-offer" className="scroll-mt-24">
            <ProposalForm dealId={id} offered={deal.offered} fee={deal.fee} />
          </div>
        )}
      </div>
    </>
  );
}

/** The dock's headline and line of context: who this wallet is to the deal, and what's next. */
function Dock({
  deal,
  status,
  isMaker,
  allowed,
  openOffer,
  canPropose,
  connected,
  children,
}: {
  deal: DealV2;
  status: DisplayStatus;
  isMaker: boolean;
  allowed: boolean;
  openOffer: boolean;
  canPropose: boolean;
  connected: boolean;
  children: ReactNode;
}) {
  if (status === "filled" || status === "cancelled") {
    return (
      <DealDock tone="done" eyebrow="Settled" title={status === "filled" ? "This deal is done" : "This deal was cancelled"}>
        <p className="text-sm text-muted">
          {status === "filled" ? "Both sides swapped in one transaction." : "The maker called it off and took their assets back."}
          {openOffer && " Offers that weren't accepted can still be withdrawn by whoever made them."}
        </p>
        {children}
      </DealDock>
    );
  }
  if (status === "expired") {
    return (
      <DealDock tone="warn" title="This deal ran out of time">
        <p className="text-sm text-muted">Nobody can accept it now. Anyone can send the locked assets back to the maker.</p>
        {children}
      </DealDock>
    );
  }
  if (isMaker) {
    return (
      <DealDock tone="maker" eyebrow="Your deal" title={openOffer ? "Your open offer is live" : "Your deal is live"}>
        <p className="text-sm text-muted">
          {openOffer
            ? "Your side is in escrow. Accept an offer below, or cancel to take it back."
            : "Your side is in escrow until someone accepts. Cancel any time to take it back."}
        </p>
        {children}
      </DealDock>
    );
  }
  if (!connected) {
    return (
      <DealDock title={openOffer ? "Want this? Make an offer" : "Want this? Take the deal"}>
        <p className="text-sm text-muted">Connect a wallet to {openOffer ? "send an offer" : "accept this deal"}.</p>
        <div>
          <ConnectButton />
        </div>
      </DealDock>
    );
  }
  if (!allowed) {
    return (
      <DealDock tone="blocked" title="This offer is for someone else">
        <p className="text-sm text-muted">
          Only <Who address={deal.taker!} /> can accept it.
        </p>
        {children}
      </DealDock>
    );
  }
  return (
    <DealDock title={canPropose ? "Send the maker an offer" : "Take the deal"}>
      {canPropose && <p className="text-sm text-muted">Your offer is held in escrow while they decide. Take it back any time before they accept.</p>}
      {children}
    </DealDock>
  );
}

/** Amounts DeClubEscrow is holding for `account` from this deal's assets (rejected payouts). */
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
