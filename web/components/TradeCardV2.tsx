"use client";

import { formatUnits } from "viem";
import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { CHOG_ADDRESS } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import type { TradeV2 } from "@/lib/tradesV2";
import { ChogThumb } from "./Chog";
import { MonPill, TradeCardFrame } from "./TradeParts";

type Info = ReadonlyMap<string, TokenInfo>;

const chip =
  "inline-flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-[#111318] bg-white px-1.5 text-center leading-tight text-[#111318] shadow-[0.18rem_0.18rem_0_#111318]";

function AssetTile({ asset, info }: { asset: Asset; info: Info }) {
  if (asset.kind === "native") return <MonPill wei={asset.amount} />;
  if (asset.kind === "erc721") {
    // Chog artwork exists only for the Chog collection; any other NFT gets a plain tile.
    if (asset.token.toLowerCase() === CHOG_ADDRESS.toLowerCase()) return <ChogThumb id={asset.id} large />;
    return (
      <span className={chip}>
        <span className="text-[10px] font-black tracking-wider text-[#a9282f] uppercase">NFT</span>
        <span className="text-[11px] font-semibold">#{asset.id.toString()}</span>
        <span className="font-mono text-[9px] text-[#4e5968]">{shortAddress(asset.token)}</span>
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
        {token?.symbol ?? shortAddress(asset.token)}
      </span>
    </span>
  );
}

/** One side of a V2 trade as tiles: Chog art, plain NFT tiles, token amounts and a MON pill. */
export function AssetSide({ assets, info }: { assets: readonly Asset[]; info: Info }) {
  if (assets.length === 0) return <span className="text-sm text-muted">Nothing</span>;
  return (
    <div className="flex min-h-20 flex-wrap items-start justify-center gap-2">
      {assets.map((a) => (
        <span key={`${a.kind}:${a.token}:${a.id}`} title={formatAsset(a, info.get(a.token.toLowerCase()))}>
          <AssetTile asset={a} info={info} />
        </span>
      ))}
    </div>
  );
}

export function TradeCardV2({ trade, now, me, info }: { trade: TradeV2; now: number; me?: string; info: Info }) {
  return (
    <TradeCardFrame
      href={`/v2/trade/${trade.id}`}
      trade={trade}
      now={now}
      me={me}
      gives={<AssetSide assets={trade.offered} info={info} />}
      wants={<AssetSide assets={trade.requested} info={info} />}
    />
  );
}

export function TradeGridV2({ trades, now, me, info }: { trades: TradeV2[]; now: number; me?: string; info: Info }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {trades.map((t) => (
        <TradeCardV2 key={t.id.toString()} trade={t} now={now} me={me} info={info} />
      ))}
    </div>
  );
}
