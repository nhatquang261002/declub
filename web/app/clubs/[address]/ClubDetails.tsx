"use client";

import { formatUnits, getAddress, type Address } from "viem";
import { CheckIcon, CopyIcon, ExternalIcon } from "@/components/Icons";
import { KIND_LABEL } from "@/components/ClubCard";
import { useClubPage } from "@/hooks/useClubBoard";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { infoAssets, type ClubInfo } from "@/lib/clubs";
import { explorerAddress } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { useCopy } from "@/components/CopyAddress";

/** Copies text, and says so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" className="icon-btn size-7" aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label} onClick={() => copy(text)}>
      {copied ? <CheckIcon className="size-4 text-[#1f7a55]" /> : <CopyIcon className="size-4" />}
    </button>
  );
}

/** Who earns the Holder badge in a Club with a memecoin: the NFTs always, the coin as the Owner set it (ADR 0026). */
function holderRule(nft: string, coin: { symbol: string; on: boolean; min: string } | null | undefined, decimals: number | undefined) {
  if (!coin) return "Deals in either count toward its Momentum.";
  if (!coin.on) return `Deals in either count toward its Momentum. Only ${nft} NFTs earn the Holder badge.`;
  const least = decimals === undefined ? "" : ` (at least ${formatUnits(BigInt(coin.min), decimals)})`;
  return `Deals in either count toward its Momentum. Holding a ${nft} or ${coin.symbol}${least} earns the Holder badge.`;
}

/** What the Club's assets are and how holding earns the badge, folded away under the header: it's reference, not the page. */
export function ClubDetails({ club }: { club: ClubInfo }) {
  const assets = infoAssets(club);
  const coin = useClubPage(club.token)?.coin;
  const { info } = useTokenInfo(club.linked ? [club.linked.token as Address] : []);
  return (
    <details className="club-details mt-4">
      <summary>Contract details</summary>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((asset) => {
          const address = getAddress(asset.token);
          return (
            <div key={asset.token}>
              <dt className="text-xs text-muted">
                {assets.length > 1 ? `${asset.symbol} · ${KIND_LABEL[asset.kind]}` : "Contract"} ({asset.kind === "erc721" ? "ERC-721" : "ERC-20"})
              </dt>
              <dd className="flex items-center gap-1">
                <a
                  href={explorerAddress(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs font-bold"
                >
                  {shortAddress(address)}
                  <ExternalIcon className="size-3.5" />
                </a>
                <CopyButton text={address} label={`Copy the ${asset.symbol} contract address`} />
              </dd>
            </div>
          );
        })}
        {assets.length > 1 ? (
          <div>
            <dt className="text-xs text-muted">Shared Club</dt>
            <dd className="leading-5">{holderRule(club.symbol, coin, club.linked && info.get(club.linked.token)?.decimals)}</dd>
          </div>
        ) : (
          <div>
            <dt className="text-xs text-muted">Kind</dt>
            <dd className="font-semibold">{KIND_LABEL[club.kind]}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted">Why it’s verified</dt>
          <dd className="leading-5">{club.note}</dd>
        </div>
      </dl>
    </details>
  );
}
