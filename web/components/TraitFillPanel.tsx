"use client";

import type { Address } from "viem";
import { useOwnedInSet } from "@/hooks/useOwnedInSet";
import type { TraitSlot } from "@/hooks/useTraitFill";
import { TraitClauseSummary } from "./TraitClause";

/**
 * One trait request on a deal, and (for a taker who can accept) the picker for which of their
 * own NFTs to send. `onToggle` is omitted for anyone who can't fill.
 */
export function TraitSlotView({ slot, account, onToggle }: { slot: TraitSlot; account?: Address; onToggle?: (id: bigint) => void }) {
  const ids = slot.resolved?.ids ?? [];
  const enumerable = slot.status.state === "ready" && slot.status.catalog.enumerable;
  const { owned, tooLarge, isLoading } = useOwnedInSet(slot.asset.token, onToggle ? account : undefined, ids, enumerable);
  const need = Number(slot.asset.amount);

  return (
    <div className="space-y-2">
      <TraitClauseSummary clause={slot.clause} matches={slot.resolved?.ids.length} check={slot.check} />
      {onToggle && slot.check === "matches" && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted">
            Choose {need} of yours ({slot.chosen.length} chosen)
          </div>
          {isLoading && <p className="text-xs text-muted">Looking for matching NFTs in your wallet…</p>}
          {tooLarge && <p className="text-xs text-warn">This set is too large to check your wallet from here.</p>}
          {!isLoading && !tooLarge && owned.length === 0 && <p className="text-xs text-warn">You don&apos;t hold an NFT that matches this request.</p>}
          <div className="flex flex-wrap gap-2">
            {owned.map((id) => {
              const on = slot.chosen.includes(id);
              return (
                <button
                  key={id.toString()}
                  type="button"
                  aria-pressed={on}
                  className={`rounded-full border-2 border-[#111318] px-2.5 py-1 text-xs font-semibold ${on ? "bg-accent text-white" : "bg-white text-[#111318]"}`}
                  onClick={() => onToggle(id)}
                >
                  #{id.toString()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
