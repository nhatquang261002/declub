"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { trustOf, type AssetTrust } from "@/lib/assetTrust";
import type { Asset, TokenInfo } from "@/lib/assets";
import { useCollectionInfos } from "./useCollection";

/**
 * The trust of every contract in `assets` (ADR 0014), by lowercase address. Tokens are checked
 * for lookalikes by the symbol in `info`; collections by the name and symbol they report. MON
 * needs nothing.
 */
export function useAssetTrust(assets: readonly Asset[], info: ReadonlyMap<string, TokenInfo>): ReadonlyMap<string, AssetTrust> {
  const collections = useMemo(
    () => [...new Map(assets.filter((a) => a.kind === "erc721" || a.kind === "trait").map((a) => [a.token.toLowerCase(), a.token as Address])).values()],
    [assets],
  );
  const { infos } = useCollectionInfos(collections);

  return useMemo(() => {
    const out = new Map<string, AssetTrust>();
    for (const a of assets) {
      if (a.kind === "native") continue;
      const key = a.token.toLowerCase();
      if (out.has(key)) continue;
      const claimed = a.kind === "erc20" ? { symbol: info.get(key)?.symbol } : { name: infos.get(key)?.name, symbol: infos.get(key)?.symbol };
      out.set(key, trustOf(a.token, claimed));
    }
    return out;
  }, [assets, info, infos]);
}
