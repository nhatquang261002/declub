"use client";

import { Alert } from "@/components/Alert";
import { CopyAddress } from "@/components/CopyAddress";
import { ExternalIcon } from "@/components/Icons";
import { allVerified, contractOf, type SideTrust } from "@/lib/assetTrust";
import { formatAsset, type Asset, type TokenInfo } from "@/lib/assets";
import { explorerAddress } from "@/lib/config";

/**
 * What stands between a person and assets they'd receive that aren't on the verified list
 * (ADR 0014): a blocked asset stops the swap, an unverified one needs a tick saying they've checked
 * its contract. `confirmed` and `onConfirm` are the tick. Renders nothing when all is verified.
 *
 * Only what the person *receives* needs this: what they hand over is their own.
 */
export function TrustCheck({
  side,
  info,
  confirmed,
  onConfirm,
  receiving = "you'd receive",
}: {
  side: SideTrust;
  info: ReadonlyMap<string, TokenInfo>;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
  /** How the screen names what's coming: "you'd receive", "this offer gives you". */
  receiving?: string;
}) {
  if (allVerified(side)) return null;

  if (side.blocked.length > 0) {
    return (
      <Alert tone="danger" title="Blocked asset">
        <p>Something {receiving} is on DeClub&apos;s blocked list, usually a scam or a copy of a real collection, so it can&apos;t be accepted here.</p>
        <AssetAddresses assets={side.blocked} info={info} />
      </Alert>
    );
  }

  const copies = side.lookalikes;
  return (
    <Alert tone="warn" title={copies.length > 0 ? "Looks like a copy" : "Not verified"}>
      {copies.length > 0 ? (
        copies.map(({ asset, of }) => (
          <p key={`${asset.kind}:${asset.token}:${asset.id}`}>
            {formatAsset(asset, info.get(asset.token.toLowerCase()))} is named like <strong>{of.name}</strong>, but it isn&apos;t the verified contract. The
            real one is at <span className="break-all font-mono text-xs">{of.address}</span>.
          </p>
        ))
      ) : (
        <p>Anyone can make a contract with any name. Check that these are the contracts you expect before you swap.</p>
      )}
      <AssetAddresses assets={side.unverified} info={info} />
      <label className="mt-3 flex items-start gap-2 font-semibold">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} />
        <span>I&apos;ve checked these contract addresses</span>
      </label>
    </Alert>
  );
}

/** Each asset with its whole contract address and an explorer link, for checking by hand. */
function AssetAddresses({ assets, info }: { assets: readonly Asset[]; info: ReadonlyMap<string, TokenInfo> }) {
  return (
    <ul className="mt-2 space-y-1">
      {assets.map((asset) => {
        const token = contractOf(asset)!;
        return (
          <li key={`${asset.kind}:${asset.token}:${asset.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-semibold">{formatAsset(asset, info.get(token.toLowerCase()))}</span>
            <CopyAddress address={token} full className="font-mono" />
            <a href={explorerAddress(token)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
              Explorer <ExternalIcon className="size-3" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
