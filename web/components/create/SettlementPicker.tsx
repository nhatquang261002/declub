import Link from "next/link";
import { Tooltip } from "@/components/Tooltip";
import type { Settlement } from "@/lib/createFlow";
import { SETTLEMENT_GUIDE, termGuide, termsFor, type SettlementTerm } from "@/lib/settlementTerms";

type Mode = {
  key: Settlement;
  title: string;
  tagline: string;
  bestFor: string;
};

const MODES: ReadonlyArray<Mode> = [
  {
    key: "escrow",
    title: "Lock assets now",
    tagline: "Held in the contract until someone accepts.",
    bestFor: "a specific buyer, a high-value trade, or anything with MON or a trait.",
  },
  {
    key: "signed",
    title: "Sign only",
    tagline: "You sign it. A matcher settles it when something fits.",
    bestFor: "quick swaps of NFTs and tokens where you'd rather not lock anything.",
  },
];

/** A plus or minus to know at a glance. Point at it for the one-line reason; it links to the Guide. */
function TermChip({ term }: { term: SettlementTerm }) {
  return (
    <Tooltip content={term.tip} href={termGuide(term)}>
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-black/15 bg-white/60 px-2 py-0.5 text-xs font-semibold ${
          term.good ? "text-mint" : "text-warn"
        }`}
      >
        <span aria-hidden>{term.good ? "+" : "−"}</span>
        {term.label}
      </span>
    </Tooltip>
  );
}

/**
 * Step 1's first choice, when signed swaps are enabled: how the deal settles. The deal itself
 * (what you give, what you want) is the same either way; this picks guaranteed-but-locked or
 * free-but-not-guaranteed (ADR 0008). The cards stay quiet (a line and three chips); each chip's
 * tooltip says why, and links to its section of the Guide (lib/settlementTerms.ts).
 */
export function SettlementPicker({ value, onChange }: { value: Settlement; onChange: (value: Settlement) => void }) {
  const selected = MODES.find((m) => m.key === value)!;
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="How it settles" className="grid gap-4 md:grid-cols-2">
        {MODES.map(({ key, title, tagline }) => {
          const on = value === key;
          return (
            // The radio's button stretches over the whole card (its ::after), and the chips sit
            // above it, so a tooltip can be opened without picking the card.
            <div
              key={key}
              className={`page-section relative flex flex-col gap-2 p-4 pt-5 transition-transform ${
                on ? "outline-[3px] outline-offset-2 outline-accent" : "hover:-translate-y-0.5"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(key)}
                className="flex items-start justify-between gap-3 text-left after:absolute after:inset-0 after:content-['']"
              >
                <span className="text-lg font-bold leading-tight">{title}</span>
                <span
                  aria-hidden
                  className={`grid size-5 shrink-0 place-items-center rounded-full border-2 border-[#111318] text-[11px] font-black text-white ${
                    on ? "bg-accent" : "bg-white"
                  }`}
                >
                  {on && "✓"}
                </span>
              </button>
              <span className="text-sm leading-5 text-muted">{tagline}</span>
              <span className="relative z-10 mt-1 flex flex-wrap gap-1.5">
                {termsFor(key).map((term) => (
                  <TermChip key={term.id} term={term} />
                ))}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted">
        <span className="font-semibold">Best for:</span> {selected.bestFor}{" "}
        <Link href={SETTLEMENT_GUIDE} className="font-semibold text-accent underline">
          How they differ →
        </Link>
      </p>
    </div>
  );
}
