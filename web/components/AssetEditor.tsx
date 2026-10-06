"use client";

import { useState } from "react";
import { isAddress, type Address } from "viem";
import { NftPicker } from "@/components/NftPicker";
import { TokenPicker } from "@/components/TokenPicker";
import { useCollectionInfo, useTokenViews } from "@/hooks/useCollection";
import { CHOG_ADDRESS, MAX_TOKENS_PER_SIDE, MOCK_ERC20_ADDRESS } from "@/lib/config";
import { newRow, type DraftRow } from "@/lib/assetDraft";
import type { TokenInfo } from "@/lib/assets";
import { collectionLabel } from "@/lib/collections";
import { useRememberCollection } from "@/hooks/useRecentCollections";
import { CopyAddress } from "@/components/CopyAddress";

const KIND_LABEL = { native: "MON", erc20: "Token", erc721: "NFT" } as const;

type Props = {
  title: string;
  hint?: string;
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
  /** On-chain symbol and decimals for the token addresses typed so far. */
  info: ReadonlyMap<string, TokenInfo>;
  /** False hides "+ MON": an intent can't use it (a contract can't pull MON from a wallet). */
  allowNative?: boolean;
  /** Token amounts are a floor ("at least"), as on the want side of an intent. */
  amountIsMinimum?: boolean;
  /** The wallet giving these assets. With it, the NFT picker lists that wallet's NFTs; without, it browses. */
  owner?: Address;
};

/**
 * One side of a DeClubEscrow deal: a list of MON / token / NFT rows. A token's name always comes from the
 * token contract (`info`), never from the user, so a lookalike can't pass for a real one.
 */
export function AssetEditor({ title, hint, rows, onChange, info, allowNative = true, amountIsMinimum = false, owner }: Props) {
  // `replace` is the row being changed; `collection` starts the picker inside one collection.
  const [picker, setPicker] = useState<{ replace?: string; collection?: Address } | null>(null);
  // The ERC-20 row whose token is being searched for.
  const [tokenRow, setTokenRow] = useState<string | null>(null);
  const rememberCollection = useRememberCollection();
  const update = (key: string, patch: Partial<DraftRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const full = rows.length >= MAX_TOKENS_PER_SIDE;
  const hasNative = rows.some((row) => row.kind === "native");

  // A row with no NFT chosen yet is a placeholder: the picker fills it instead of adding another.
  const isPlaceholder = (row: DraftRow) => row.kind === "erc721" && row.token.trim() === "" && row.value.trim() === "";
  const kept = rows.filter((row) => !isPlaceholder(row) && row.key !== picker?.replace);
  const room = MAX_TOKENS_PER_SIDE - kept.length;
  const taken = new Set(
    kept.flatMap((row) => (row.kind === "erc721" && isAddress(row.token.trim()) && /^\d+$/.test(row.value.trim()) ? [`${row.token.trim().toLowerCase()}:${BigInt(row.value.trim())}`] : [])),
  );
  const openPicker = (next: { replace?: string; collection?: Address }) => setPicker(next);

  function addNfts(collection: Address, ids: bigint[]) {
    const added = ids.map((id) => newRow("erc721", collection, id.toString()));
    const replace = picker?.replace;
    rememberCollection(collection);
    setPicker(null);
    if (replace) {
      onChange(rows.flatMap((row) => (row.key === replace ? added : [row])));
    } else {
      onChange([...rows.filter((row) => !isPlaceholder(row)), ...added]);
    }
  }

  return (
    <section className="page-section space-y-4 p-4">
      <div>
        <h2 className="label !mb-0">{title}</h2>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>

      {rows.length === 0 && <p className="text-sm text-muted">Nothing added yet.</p>}

      <ul className="space-y-3">
        {rows.map((row, i) => {
          const token = row.token.trim();
          const known = row.kind === "erc20" && isAddress(token) ? info.get(token.toLowerCase()) : undefined;
          return (
            <li key={row.key} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip chip-dark w-16 shrink-0 justify-center">
                  {KIND_LABEL[row.kind]}
                </span>
                {row.kind === "erc721" ? (
                  <NftSummary
                    row={row}
                    onChoose={() => openPicker({ replace: row.key, collection: isAddress(token) ? token : undefined })}
                  />
                ) : (
                  <>
                    {row.kind !== "native" && (
                      <>
                        <input
                          aria-label={`Row ${i + 1} token address`}
                          className="input min-w-0 flex-1 basis-56 font-mono"
                          placeholder="Token address 0x…"
                          value={row.token}
                          onChange={(e) => update(row.key, { token: e.target.value })}
                        />
                        <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setTokenRow(row.key)}>
                          Search
                        </button>
                      </>
                    )}
                    <input
                      aria-label={`Row ${i + 1} amount`}
                      className="input w-32 shrink-0"
                      inputMode="decimal"
                      placeholder={amountIsMinimum ? "At least" : "Amount"}
                      value={row.value}
                      onChange={(e) => update(row.key, { value: e.target.value })}
                    />
                  </>
                )}
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  aria-label={`Remove row ${i + 1}`}
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                >
                  ✕
                </button>
              </div>
              {row.kind === "erc20" && isAddress(token) && (
                <p className={`text-xs ${known ? "text-mint" : "text-warn"}`}>
                  {known ? `${known.symbol} · ${known.decimals} decimals (read from the token)` : "Checking the token…"}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        {allowNative && (
          <button type="button" className="btn-secondary btn-sm" disabled={full || hasNative} onClick={() => onChange([...rows, newRow("native")])}>
            + MON
          </button>
        )}
        <button type="button" className="btn-secondary btn-sm" disabled={full} onClick={() => onChange([...rows, newRow("erc20")])}>
          + Token
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={full && !rows.some(isPlaceholder)} onClick={() => openPicker({})}>
          + NFT
        </button>
        {MOCK_ERC20_ADDRESS && (
          <button type="button" className="btn-secondary btn-sm" disabled={full} onClick={() => onChange([...rows, newRow("erc20", MOCK_ERC20_ADDRESS)])}>
            + Test token
          </button>
        )}
        <button type="button" className="btn-secondary btn-sm" disabled={full && !rows.some(isPlaceholder)} onClick={() => openPicker({ collection: CHOG_ADDRESS })}>
          + Chog
        </button>
      </div>

      {tokenRow && (
        <TokenPicker
          owner={owner}
          onSelect={(token) => {
            update(tokenRow, { token });
            setTokenRow(null);
          }}
          onClose={() => setTokenRow(null)}
        />
      )}

      {picker && (
        <NftPicker
          owner={owner}
          collection={picker.collection}
          room={room}
          taken={taken}
          onConfirm={addNfts}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}

/** One NFT row: its art, name and collection, read from the chain, with a button to change it. */
function NftSummary({ row, onChoose }: { row: DraftRow; onChoose: () => void }) {
  const token = row.token.trim();
  const collection = isAddress(token) ? token : undefined;
  const id = /^\d+$/.test(row.value.trim()) ? BigInt(row.value.trim()) : undefined;
  const { info } = useCollectionInfo(collection);
  const views = useTokenViews(collection, id === undefined ? [] : [id]);
  const view = id === undefined ? undefined : views.get(id.toString());

  if (!collection || id === undefined) {
    return (
      <button type="button" className="btn-secondary min-w-0 flex-1 basis-56 justify-start" onClick={onChoose}>
        Choose an NFT…
      </button>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border-2 border-[#111318] bg-panel-2 font-mono text-[10px] text-muted">
        {view?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.image} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          `#${id}`
        )}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block truncate font-semibold">{view?.name ?? `#${id}`}</span>
        <span className="block truncate text-xs text-muted">
          {collectionLabel(info, "Collection")} · <CopyAddress address={collection} />
        </span>
      </span>
      <button type="button" className="btn-secondary btn-sm shrink-0" onClick={onChoose}>
        Change
      </button>
    </div>
  );
}
