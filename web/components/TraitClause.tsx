import { shortAddress } from "@/lib/format";
import { describePicks, type TraitClause } from "@/lib/traitSpec";

/** Whether the request, rebuilt from its published description, commits to the deal's root. */
export type ClauseCheck = "matches" | "differs" | "checking" | "unavailable";

const CHECK_TEXT: Record<ClauseCheck, string> = {
  matches: "Checked: this description matches what the deal commits to.",
  differs: "This description doesn't match what the deal commits to. The collection's traits may have changed, so it can't be accepted from here.",
  checking: "Checking the description against the deal…",
  unavailable: "Can't check this description: the collection's traits couldn't be read.",
};

/** One trait request: how many NFTs, from which collection, with which traits. */
export function TraitClauseSummary({
  clause,
  matches,
  check,
}: {
  clause: TraitClause;
  /** How many NFTs match today, when the set has been rebuilt. */
  matches?: number;
  check?: ClauseCheck;
}) {
  return (
    <div className="rounded-xl border border-[#d83b45]/30 bg-[#fff4cf] p-3 text-[#111318]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm bg-[#d83b45] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white">
          trait request
        </span>
        <span className="font-semibold">
          {clause.amount} NFT{clause.amount === 1 ? "" : "s"} with {clause.picks.length > 1 ? (clause.mode === "all" ? "all of: " : "any of: ") : ""}
          {describePicks(clause)}
        </span>
      </div>
      <p className="mt-1 text-xs text-[#5d6270]">
        From <span className="font-mono">{shortAddress(clause.token)}</span>
        {matches !== undefined && ` · ${matches.toLocaleString()} NFT${matches === 1 ? "" : "s"} match today`}
      </p>
      {check && (
        <p className={`mt-1 text-xs ${check === "differs" ? "font-semibold text-[#a9282f]" : "text-[#5d6270]"}`}>{CHECK_TEXT[check]}</p>
      )}
    </div>
  );
}
