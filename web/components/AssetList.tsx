"use client";

import Image from "next/image";
import { useMemo } from "react";
import { useCollectionInfo, useTokenViews } from "@/hooks/useCollection";
import { trustOf } from "@/lib/assetTrust";
import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { collectionLabel } from "@/lib/collections";
import { CHOG_ADDRESS, explorerAddress } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { ChogImage } from "./Chog";
import { ExternalIcon } from "./Icons";
import { TrustChip } from "./TrustChip";
import { CopyAddress } from "@/components/CopyAddress";

type Info = ReadonlyMap<string, TokenInfo>;

const KIND_TEXT = { native: "Native coin", erc20: "Token", erc721: "NFT", trait: "By trait" } as const;

/**
 * A read-only side of a deal. Token names come from the token contracts (`info`), so every row
 * also shows the contract and where it stands on the verified list (ADR 0014).
 */
export function AssetList({ assets, info }: { assets: readonly Asset[]; info: Info }) {
  return (
    <ul className="space-y-2">
      {assets.map((a) => (
        <li key={`${a.kind}:${a.token}:${a.id}`}>{a.kind === "erc721" ? <NftRow asset={a} /> : <AmountRow asset={a} info={info} />}</li>
      ))}
    </ul>
  );
}

function ExplorerLink({ token }: { token: string }) {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted">
      <a
        href={explorerAddress(token)}
        target="_blank"
        rel="noreferrer"
        title={`View ${token} on the explorer`}
        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      >
        {shortAddress(token)}
        <ExternalIcon className="size-3" />
      </a>
      <CopyAddress address={token} iconOnly label={`Copy ${token}`} />
    </span>
  );
}

/** MON, a token amount or a trait request: a badge, the amount, and the contract. */
function AmountRow({ asset, info }: { asset: Asset; info: Info }) {
  const token = info.get(asset.token.toLowerCase());
  // A trait request names a collection, which says its own name.
  const { info: collection } = useCollectionInfo(asset.kind === "trait" ? asset.token : undefined);
  const trust =
    asset.kind === "native"
      ? null
      : trustOf(asset.token, asset.kind === "erc20" ? { symbol: token?.symbol } : { name: collection?.name, symbol: collection?.symbol });
  return (
    <div className="asset-row">
      <span className="asset-badge" data-kind={asset.kind}>
        {asset.kind === "native" ? (
          <Image src="/brand/mon.svg" alt="" width={22} height={22} className="size-[22px]" />
        ) : asset.kind === "erc20" ? (
          <span className="max-w-full truncate px-0.5">{token?.symbol?.slice(0, 5) ?? "ERC20"}</span>
        ) : (
          "Trait"
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold tabular-nums">{formatAsset(asset, token)}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {KIND_TEXT[asset.kind]}
          {trust && <TrustChip trust={trust} />}
        </span>
      </span>
      {asset.kind !== "native" && <ExplorerLink token={asset.token} />}
    </div>
  );
}

/** One NFT: its art and name from the chain (Chogs use the app's own art), and its collection. */
function NftRow({ asset }: { asset: Asset }) {
  const isChog = asset.token.toLowerCase() === CHOG_ADDRESS.toLowerCase();
  const ids = useMemo(() => (isChog ? [] : [asset.id]), [isChog, asset.id]);
  const { info } = useCollectionInfo(asset.token);
  const view = useTokenViews(isChog ? undefined : asset.token, ids).get(asset.id.toString());
  const trust = trustOf(asset.token, { name: info?.name, symbol: info?.symbol });

  return (
    <div className="asset-row">
      <span className="asset-badge" data-kind="erc721">
        {isChog ? (
          <ChogImage id={asset.id} className="size-full" />
        ) : view?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          "NFT"
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{view?.name ?? `#${asset.id}`}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span className="truncate">
            {collectionLabel(info, isChog ? "Chog" : "NFT")}
            {view?.name && ` · #${asset.id}`}
          </span>
          <TrustChip trust={trust} />
        </span>
      </span>
      <ExplorerLink token={asset.token} />
    </div>
  );
}
