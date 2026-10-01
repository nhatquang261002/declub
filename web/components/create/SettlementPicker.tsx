import type { Settlement } from "@/lib/createFlow";

const MODES: ReadonlyArray<{ key: Settlement; title: string; blurb: string; scope: string }> = [
  {
    key: "escrow",
    title: "Lock assets now",
    blurb: "Your side is held in the contract until someone accepts. Once it's on-chain, it can't fail.",
    scope: "Costs gas · MON, NFTs, tokens and trait requests",
  },
  {
    key: "signed",
    title: "Sign only",
    blurb: "Sign what you give and want. Nothing is locked, and a matcher settles it when something fits.",
    scope: "Free to post · NFTs and tokens only, no MON or traits",
  },
];

/**
 * Step 1's first choice, when signed swaps are enabled: how the deal settles. The deal itself
 * (what you give, what you want) is the same either way; this picks guaranteed-but-locked or
 * free-but-not-guaranteed (ADR 0008).
 */
export function SettlementPicker({ value, onChange }: { value: Settlement; onChange: (value: Settlement) => void }) {
  return (
    <div role="radiogroup" aria-label="How it settles" className="grid gap-4 md:grid-cols-2">
      {MODES.map(({ key, title, blurb, scope }) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(key)}
            className={`page-section flex flex-col gap-2 p-4 pt-5 text-left transition-transform ${
              selected ? "outline-[3px] outline-offset-2 outline-accent" : "hover:-translate-y-0.5"
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-lg font-bold leading-tight">{title}</span>
              <span
                aria-hidden
                className={`grid size-5 shrink-0 place-items-center rounded-full border-2 border-[#111318] text-[11px] font-black text-white ${
                  selected ? "bg-accent" : "bg-white"
                }`}
              >
                {selected && "✓"}
              </span>
            </span>
            <span className="text-sm leading-6 text-muted">{blurb}</span>
            <span className="mt-auto pt-1 text-xs font-semibold text-muted">{scope}</span>
          </button>
        );
      })}
    </div>
  );
}
