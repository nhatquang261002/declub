"use client";

import { isAddress } from "viem";
import { CHOG_ADDRESS, MAX_TOKENS_PER_SIDE, MOCK_ERC20_ADDRESS } from "@/lib/config";
import { newRow, type DraftRow } from "@/lib/assetDraft";
import type { TokenInfo } from "@/lib/assets";

const KIND_LABEL = { native: "MON", erc20: "Token", erc721: "NFT" } as const;

type Props = {
  title: string;
  hint?: string;
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
  /** On-chain symbol and decimals for the token addresses typed so far. */
  info: ReadonlyMap<string, TokenInfo>;
};

/**
 * One side of a V2 deal: a list of MON / token / NFT rows. A token's name always comes from the
 * token contract (`info`), never from the user, so a lookalike can't pass for a real one.
 */
export function AssetEditor({ title, hint, rows, onChange, info }: Props) {
  const update = (key: string, patch: Partial<DraftRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const full = rows.length >= MAX_TOKENS_PER_SIDE;
  const hasNative = rows.some((row) => row.kind === "native");

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
                <span className="w-16 shrink-0 rounded-full bg-white/10 px-2 py-1 text-center text-xs font-semibold">
                  {KIND_LABEL[row.kind]}
                </span>
                {row.kind !== "native" && (
                  <input
                    aria-label={`Row ${i + 1} ${row.kind === "erc20" ? "token" : "collection"} address`}
                    className="input min-w-0 flex-1 basis-56 font-mono"
                    placeholder={row.kind === "erc20" ? "Token address 0x…" : "Collection address 0x…"}
                    value={row.token}
                    onChange={(e) => update(row.key, { token: e.target.value })}
                  />
                )}
                <input
                  aria-label={`Row ${i + 1} ${row.kind === "erc721" ? "token id" : "amount"}`}
                  className="input w-32 shrink-0"
                  inputMode={row.kind === "erc721" ? "numeric" : "decimal"}
                  placeholder={row.kind === "erc721" ? "Token id" : "Amount"}
                  value={row.value}
                  onChange={(e) => update(row.key, { value: e.target.value })}
                />
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
        <button type="button" className="btn-secondary btn-sm" disabled={full || hasNative} onClick={() => onChange([...rows, newRow("native")])}>
          + MON
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={full} onClick={() => onChange([...rows, newRow("erc20")])}>
          + Token
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={full} onClick={() => onChange([...rows, newRow("erc721")])}>
          + NFT
        </button>
        {MOCK_ERC20_ADDRESS && (
          <button type="button" className="btn-secondary btn-sm" disabled={full} onClick={() => onChange([...rows, newRow("erc20", MOCK_ERC20_ADDRESS)])}>
            + Test token
          </button>
        )}
        <button type="button" className="btn-secondary btn-sm" disabled={full} onClick={() => onChange([...rows, newRow("erc721", CHOG_ADDRESS)])}>
          + Chog
        </button>
      </div>
    </section>
  );
}
