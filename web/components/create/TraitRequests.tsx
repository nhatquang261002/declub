"use client";

import { isAddress } from "viem";
import { Tabs } from "@/components/Tabs";
import { statusOf, type CatalogStatus } from "@/hooks/useCollectionTraits";
import { CHOG_ADDRESS, MAX_TOKENS_PER_SIDE } from "@/lib/config";
import { newTraitDraft, type TraitDraft } from "@/lib/traitDraft";
import {
  describePicks,
  MAX_TRAIT_PICKS,
  pickLabel,
  samePick,
  traitOptions,
  type ResolvedClause,
  type TraitMode,
  type TraitPick,
} from "@/lib/traitSpec";

type Props = {
  drafts: TraitDraft[];
  onChange: (drafts: TraitDraft[]) => void;
  statuses: ReadonlyMap<string, CatalogStatus>;
  resolved: readonly (ResolvedClause | null)[];
  /** How many more requests fit on the requested side, next to the other assets. */
  room: number;
};

const chip = "rounded-full border-2 border-[#111318] px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45";

/**
 * Trait requests for a V2 deal: pick a collection, and if its traits can be read, pick 2–3 (up to
 * MAX_TRAIT_PICKS) and say whether an NFT needs any of them or all of them. The matching ids and
 * their Merkle root are computed from the scan, so nothing here is typed except the collection.
 */
export function TraitRequests({ drafts, onChange, statuses, resolved, room }: Props) {
  const update = (key: string, patch: Partial<TraitDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <section className="page-section space-y-4 p-4">
      <div>
        <h2 className="label !mb-0">You request by trait</h2>
        <p className="mt-1 text-xs text-muted">
          Choose a collection, then the traits you want. Anyone holding a matching NFT can accept. The deal commits to
          the NFTs that match today.
        </p>
      </div>

      <ul className="space-y-4">
        {drafts.map((draft, i) => (
          <li key={draft.key} className="space-y-3 rounded-xl border-2 border-[#111318] bg-white p-3 shadow-[0.2rem_0.2rem_0_#f0b735]">
            <TraitRequestRow
              index={i}
              draft={draft}
              status={statusOf(statuses, draft.collection)}
              resolved={resolved[i]}
              onChange={(patch) => update(draft.key, patch)}
              onRemove={drafts.length > 1 ? () => onChange(drafts.filter((d) => d.key !== draft.key)) : undefined}
            />
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={room <= 0}
        onClick={() => onChange([...drafts, newTraitDraft()])}
      >
        + Another trait request
      </button>
    </section>
  );
}

function TraitRequestRow({
  index,
  draft,
  status,
  resolved,
  onChange,
  onRemove,
}: {
  index: number;
  draft: TraitDraft;
  status: CatalogStatus;
  resolved: ResolvedClause | null;
  onChange: (patch: Partial<TraitDraft>) => void;
  onRemove?: () => void;
}) {
  const collection = draft.collection.trim();
  const matches = resolved?.ids.length ?? 0;
  const maxAmount = Math.min(MAX_TOKENS_PER_SIDE, Math.max(matches, 1));

  const toggle = (pick: TraitPick) => {
    const has = draft.picks.some((p) => samePick(p, pick));
    onChange({ picks: has ? draft.picks.filter((p) => !samePick(p, pick)) : [...draft.picks, pick] });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={`Trait request ${index + 1} collection address`}
          className="input min-w-0 flex-1 basis-64 font-mono"
          placeholder="Collection address 0x…"
          value={draft.collection}
          onChange={(e) => onChange({ collection: e.target.value, picks: [] })}
        />
        <button type="button" className="btn-secondary btn-sm" onClick={() => onChange({ collection: CHOG_ADDRESS, picks: [] })}>
          Chog
        </button>
        {onRemove && (
          <button type="button" className="btn-danger btn-sm" aria-label={`Remove trait request ${index + 1}`} onClick={onRemove}>
            ✕
          </button>
        )}
      </div>

      {collection === "" && <p className="text-xs text-muted">Paste a collection address to see which traits it has.</p>}
      {collection !== "" && !isAddress(collection) && <p className="text-xs text-warn">That isn&apos;t a valid address.</p>}
      {isAddress(collection) && <ScanStatus status={status} />}

      {status.state === "ready" && (
        <>
          {draft.picks.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {draft.picks.map((pick) => (
                <button
                  key={`${pick.traitType}:${pick.value}`}
                  type="button"
                  className={`${chip} bg-accent text-white`}
                  aria-label={`Remove ${pickLabel(pick)}`}
                  onClick={() => toggle(pick)}
                >
                  {pickLabel(pick)} ✕
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {traitOptions(status.catalog).map(({ traitType, values }) => {
              const chosen = draft.picks.filter((p) => p.traitType === traitType).length;
              return (
                <details key={traitType} className="rounded-lg border-[1.5px] border-[#111318]/15 bg-[#fff4cf]/60 px-3 py-2 open:bg-white">
                  <summary className="cursor-pointer text-sm font-semibold">
                    {traitType}
                    {chosen > 0 && <span className="ml-2 text-xs text-muted">{chosen} chosen</span>}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {values.map(({ value, count }) => {
                      const pick = { traitType, value };
                      const on = draft.picks.some((p) => samePick(p, pick));
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={on}
                          disabled={!on && draft.picks.length >= MAX_TRAIT_PICKS}
                          className={`${chip} ${on ? "bg-accent text-white" : "bg-white text-[#111318]"}`}
                          onClick={() => toggle(pick)}
                        >
                          {value} <span className="opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
          {draft.picks.length >= MAX_TRAIT_PICKS && (
            <p className="text-xs text-muted">Up to {MAX_TRAIT_PICKS} traits per request.</p>
          )}

          {draft.picks.length > 1 && (
            <div className="space-y-1">
              <div className="label !mb-0">An NFT must have</div>
              <Tabs<TraitMode>
                label="How the traits combine"
                value={draft.mode}
                onChange={(mode) => onChange({ mode })}
                options={[
                  { value: "any", label: "Any one of them" },
                  { value: "all", label: "All of them" },
                ]}
              />
            </div>
          )}

          {draft.picks.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
              <div>
                <label className="label" htmlFor={`amount-${draft.key}`}>NFTs to receive</label>
                <input
                  id={`amount-${draft.key}`}
                  className="input w-24"
                  type="number"
                  min={1}
                  max={maxAmount}
                  value={draft.amount}
                  onChange={(e) => onChange({ amount: Math.min(Math.max(Math.trunc(Number(e.target.value)) || 1, 1), maxAmount) })}
                />
              </div>
              <p className="text-sm">
                <strong>{matches.toLocaleString()}</strong> NFT{matches === 1 ? "" : "s"} match{matches === 1 ? "es" : ""}{" "}
                <span className="text-muted">{describePicks(draft)}</span>
                {matches === 0 && <span className="text-warn"> · nothing matches, so nobody could accept</span>}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}

function ScanStatus({ status }: { status: CatalogStatus }) {
  switch (status.state) {
    case "scanning":
      return (
        <p className="text-xs text-muted">
          Reading the collection&apos;s traits…{status.total > 0 && ` ${status.done.toLocaleString()} / ${status.total.toLocaleString()}`}
        </p>
      );
    case "busy":
      return <p className="text-xs text-muted">Other collections are being read. This will start shortly…</p>;
    case "unsupported":
      return (
        <p className="text-xs text-warn">
          Can&apos;t request by trait from this collection. {status.reason} You can still request exact NFTs by id.
        </p>
      );
    case "ready":
      return (
        <>
          <p className="text-xs text-mint">Traits found for this collection.</p>
          {status.failed > 0 && (
            <p className="text-xs text-warn">
              {status.failed.toLocaleString()} token{status.failed === 1 ? "" : "s"} couldn&apos;t be read, so they&apos;re left out of every request.
            </p>
          )}
        </>
      );
    default:
      return null;
  }
}
