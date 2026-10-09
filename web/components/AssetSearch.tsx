"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatUnits, isAddress, getAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { CopyAddress } from "@/components/CopyAddress";
import { useAssetSearch, useDebounced } from "@/hooks/useAssetSearch";
import { safeImage } from "@/lib/collections";
import { mergeHits, rankHits, type SearchHit, type SearchKind } from "@/lib/search";

type Props = {
  kind: SearchKind;
  /** The wallet giving the assets. Starts the search on its holdings, with a switch to everything. */
  owner?: Address;
  /** Assets this browser already knows (recent, in open deals): shown alongside the server's results. */
  extra?: readonly SearchHit[];
  onSelect: (hit: SearchHit) => void;
  /** What to show in place of the results when the text is a full address. */
  renderPasted: (address: Address) => ReactNode;
  placeholder?: string;
  label: string;
};

const NOUN = { erc20: "token", erc721: "collection" } as const;

/** A holding as a person reads it: "1,250 mUSD" or "3 owned". */
function holdingLabel(hit: SearchHit): string | null {
  if (!hit.held) return null;
  if (hit.kind === "erc721") return `${hit.count ?? 1} owned`;
  if (hit.balance === undefined) return "You hold some";
  const amount =
    hit.decimals === undefined ? hit.balance : Number(formatUnits(BigInt(hit.balance), hit.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return `${amount} ${hit.symbol}`.trim();
}

/**
 * The search box and result list shared by the collection and token pickers (ADR 0027). The wallet's
 * holdings come first, then verified assets, then the rest; with a wallet to give from, it starts on
 * holdings only and "All" opens it up. Names are what a provider or the contract says, so the address
 * stays on every row and only the verified list can earn a badge.
 */
export function AssetSearch({ kind, owner, extra = [], onSelect, renderPasted, placeholder, label }: Props) {
  const { address: connected } = useAccount();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<"holdings" | "all">(owner ? "holdings" : "all");
  const query = useDebounced(text.trim());
  const pasted = isAddress(text.trim()) ? getAddress(text.trim()) : null;
  // Holdings come first even when searching everything, for the wallet giving or the connected one.
  const holder = owner ?? connected;

  const search = useAssetSearch({ query: pasted ? "" : query, owner: holder, kind, scope });
  const hits = useMemo(() => {
    const local = scope === "all" ? extra.filter((h) => h.kind === kind) : [];
    return rankHits(mergeHits(search.hits, local), pasted ? "" : text);
  }, [search.hits, extra, kind, scope, text, pasted]);

  const noun = NOUN[kind];
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <label className="label !mb-0" htmlFor={`asset-search-${kind}`}>
            {label}
          </label>
          {owner && (
            <div role="group" aria-label="What to search" className="flex gap-1">
              {(["holdings", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  className={scope === value ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                  onClick={() => setScope(value)}
                >
                  {value === "holdings" ? "My holdings" : "All"}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          id={`asset-search-${kind}`}
          autoFocus
          className="input"
          placeholder={placeholder ?? "Name, symbol or 0x…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {pasted ? (
        renderPasted(pasted)
      ) : (
        <>
          {text.trim().startsWith("0x") && <p className="text-sm text-muted">Keep typing: a contract address is 42 characters.</p>}
          {search.degraded && <p className="text-xs text-warn">The full search is unavailable, so only assets this app knows are shown.</p>}
          {hits.length === 0 ? (
            <p className="text-sm text-muted">
              {search.isLoading
                ? "Searching…"
                : scope === "holdings"
                  ? `None of your ${noun}s match. Switch to All, or paste a contract address.`
                  : text.trim()
                    ? `No ${noun} matches. Paste its contract address to look it up.`
                    : `Nothing to suggest yet. Paste a contract address.`}
            </p>
          ) : (
            <ul className={`space-y-2 ${search.isStale ? "opacity-60" : ""}`}>
              {hits.map((hit) => (
                <HitRow key={hit.address} hit={hit} onSelect={() => onSelect(hit)} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function HitRow({ hit, onSelect }: { hit: SearchHit; onSelect: () => void }) {
  const logo = safeImage(hit.logo);
  const holding = holdingLabel(hit);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 rounded-xl border-[1.5px] border-[#111318]/20 bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-[#111318] hover:bg-white"
      >
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border-2 border-[#111318] bg-panel-2 font-mono text-[10px] text-muted">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            (hit.symbol || "?").slice(0, 4)
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {hit.name || "Unnamed"}
            {hit.symbol && hit.symbol !== hit.name && <span className="ml-1.5 font-normal text-muted">{hit.symbol}</span>}
          </span>
          <CopyAddress address={hit.address} inLink className="block text-xs text-muted" />
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
          {holding && <span className="font-semibold text-[#111318]">{holding}</span>}
          <span className="flex flex-wrap justify-end gap-1">
            {hit.tier === "verified" && <span className="rounded-full border border-line px-2 py-0.5">Verified</span>}
            {hit.tag && <span className="rounded-full border border-line px-2 py-0.5">{hit.tag}</span>}
            {hit.spam && <span className="rounded-full border border-line px-2 py-0.5 text-warn">Possible spam</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
