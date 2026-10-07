"use client";

import { useMemo, type ReactNode } from "react";
import { formatUnits } from "viem";
import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { CHOG_ADDRESS } from "@/lib/config";
import { isOpenOffer, type DealV2 } from "@/lib/dealsV2";
import { ChogThumb } from "./Chog";
import { MonPill, DealCardFrame } from "./DealParts";
import { CopyAddress } from "@/components/CopyAddress";
import { useCollectionInfo, useTokenViews } from "@/hooks/useCollection";

type Info = ReadonlyMap<string, TokenInfo>;

const chip =
  "inline-flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-[#111318] bg-white px-1.5 text-center leading-tight text-[#111318]";

/**
 * An NFT from any collection: its art from the token's `tokenURI` (a plain square until, or unless,
 * it loads), then its full name and its collection's name, which wrap rather than cut off.
 */
function NftTile({ asset }: { asset: Asset }) {
  const ids = useMemo(() => [asset.id], [asset.id]);
  const view = useTokenViews(asset.token as `0x${string}`, ids).get(asset.id.toString());
  const { info } = useCollectionInfo(asset.token as `0x${string}`);
  const collection = info?.name || info?.symbol;
  return (
    <div className="flex w-32 shrink-0 flex-col items-center gap-1.5 text-center">
      <div className="relative grid size-20 place-items-center overflow-hidden rounded-lg border-2 border-[#111318] bg-white">
        {view?.image ? (
          // Arbitrary hosts from token metadata, so next/image's domain list doesn't apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <span className="text-[10px] font-black tracking-wider text-[#a9282f] uppercase">NFT</span>
        )}
      </div>
      <div className="w-full min-w-0 leading-tight">
        <div className="text-[12px] font-bold break-words">{view?.name ?? `#${asset.id.toString()}`}</div>
        <div className="text-[10px] font-semibold break-words text-[#4e5968]">
          {collection ?? <CopyAddress address={asset.token} inLink />}
          {view?.name && !view.name.includes(`#${asset.id}`) && ` · #${asset.id.toString()}`}
        </div>
      </div>
    </div>
  );
}

function AssetTile({ asset, info }: { asset: Asset; info: Info }) {
  if (asset.kind === "native") return <MonPill wei={asset.amount} />;
  if (asset.kind === "erc721") {
    // Chog art is bundled with the app; any other NFT's comes from its own metadata.
    if (asset.token.toLowerCase() === CHOG_ADDRESS.toLowerCase()) return <ChogThumb id={asset.id} large />;
    return <NftTile asset={asset} />;
  }
  if (asset.kind === "trait") {
    // Which traits is in the deal's description, which a list of cards doesn't load.
    return (
      <span className={chip}>
        <span className="text-[10px] font-black tracking-wider text-[#a9282f] uppercase">By trait</span>
        <span className="text-[11px] font-semibold">Any {asset.amount.toString()}</span>
        <CopyAddress address={asset.token} inLink className="text-[9px] text-[#4e5968]" />
      </span>
    );
  }
  const token = info.get(asset.token.toLowerCase());
  return (
    <span className={chip}>
      <span className="max-w-full truncate text-[11px] font-semibold">
        {token ? formatUnits(asset.amount, token.decimals) : asset.amount.toString()}
      </span>
      <span className="max-w-full truncate text-[10px] font-black tracking-wider text-[#a9282f] uppercase">
        {token?.symbol ?? <CopyAddress address={asset.token} inLink />}
      </span>
    </span>
  );
}

/** One side of a DeClubEscrow deal as tiles: Chog art, plain NFT tiles, token amounts and a MON pill. */
export function AssetSide({ assets, info }: { assets: readonly Asset[]; info: Info }) {
  if (assets.length === 0) return <span className="text-sm text-muted">Nothing</span>;
  return (
    <div className="flex min-h-20 w-full flex-wrap items-start justify-center gap-2">
      {assets.map((a) => (
        <span key={`${a.kind}:${a.token}:${a.id}`} title={formatAsset(a, info.get(a.token.toLowerCase()))}>
          <AssetTile asset={a} info={info} />
        </span>
      ))}
    </div>
  );
}

/** The "wants" side of an open offer: no ask, takers send offers. */
function OpenToOffers() {
  return (
    <div className="flex min-h-20 items-center justify-center">
      <span className={chip}>
        <span className="text-lg leading-none" aria-hidden>
          ?
        </span>
        <span className="text-[10px] font-black tracking-wider text-[#a9282f] uppercase">Open to offers</span>
      </span>
    </div>
  );
}

export function DealCardV2({
  deal,
  now,
  me,
  info,
  tag,
}: {
  deal: DealV2;
  now: number;
  me?: string;
  info: Info;
  tag?: ReactNode;
}) {
  return (
    <DealCardFrame
      href={`/v2/deal/${deal.id}`}
      deal={deal}
      now={now}
      me={me}
      tag={tag}
      gives={<AssetSide assets={deal.offered} info={info} />}
      wants={isOpenOffer(deal) ? <OpenToOffers /> : <AssetSide assets={deal.requested} info={info} />}
    />
  );
}

export function DealGridV2({ deals, now, me, info }: { deals: DealV2[]; now: number; me?: string; info: Info }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {deals.map((t) => (
        <DealCardV2 key={t.id.toString()} deal={t} now={now} me={me} info={info} />
      ))}
    </div>
  );
}
