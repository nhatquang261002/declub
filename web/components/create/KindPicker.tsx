import type { DealKind } from "@/lib/createFlow";

const KINDS: ReadonlyArray<{ key: DealKind; title: string; blurb: string }> = [
  {
    key: "open",
    title: "Open offer",
    blurb: "Post what you're giving and let people send you offers. You choose the one you like.",
  },
  {
    key: "exact",
    title: "Request exact assets",
    blurb: "Name the assets you want back. Whoever holds them can accept in one transaction.",
  },
  {
    key: "trait",
    title: "Request by trait",
    blurb: "Ask for any Chog with a trait, like a Crown hat. Anyone with a match can accept.",
  },
];

export type KindAvailability = Record<DealKind, { scope: string; unavailable?: string }>;

/** Step 1's choice. `scope` says which assets the kind can move; `unavailable` disables it with a reason. */
export function KindPicker({
  value,
  onChange,
  availability,
}: {
  value: DealKind | null;
  onChange: (kind: DealKind) => void;
  availability: KindAvailability;
}) {
  return (
    <div role="radiogroup" aria-label="Deal type" className="grid gap-4 md:grid-cols-3">
      {KINDS.map(({ key, title, blurb }) => {
        const { scope, unavailable } = availability[key];
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!!unavailable}
            onClick={() => onChange(key)}
            className={`page-section flex flex-col gap-2 p-4 pt-5 text-left transition-transform disabled:cursor-not-allowed disabled:opacity-55 ${
              selected ? "outline-[3px] outline-offset-2 outline-accent" : "enabled:hover:-translate-y-0.5"
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
            <span className="mt-auto pt-1 text-xs font-semibold text-muted">
              {unavailable ?? scope}
            </span>
          </button>
        );
      })}
    </div>
  );
}
