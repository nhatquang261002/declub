"use client";

import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { explorerAddress } from "@/lib/config";
import { shortAddress } from "@/lib/format";

/** A read-only side of a V2 deal. Token names come from the token contracts (`info`). */
export function AssetList({ assets, info }: { assets: readonly Asset[]; info: ReadonlyMap<string, TokenInfo> }) {
  return (
    <ul className="space-y-2">
      {assets.map((a) => (
        <li key={`${a.kind}:${a.token}:${a.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
          <span className="font-semibold">
            {a.kind === "erc721" ? `NFT #${a.id}` : formatAsset(a, info.get(a.token.toLowerCase()))}
          </span>
          {a.kind !== "native" && (
            <a
              href={explorerAddress(a.token)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-muted underline hover:text-white"
            >
              {shortAddress(a.token)} ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
