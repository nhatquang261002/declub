import { STEP_LABELS, type Step } from "@/lib/createFlow";

/**
 * Progress through the create flow. Finished steps are buttons that go back; later steps aren't
 * reachable from here, because each one has to pass its own checks via "Continue".
 */
export function Stepper({ current, onJump }: { current: Step; onJump: (step: Step) => void }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label="Progress">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none sm:gap-3" aria-current={active ? "step" : undefined}>
            <button
              type="button"
              disabled={!done}
              onClick={() => onJump(n)}
              className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default"
            >
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-[#111318] text-sm font-black ${
                  active ? "bg-accent text-white" : done ? "bg-mint" : "bg-[#fff4cf] text-muted"
                }`}
              >
                {done ? "✓" : n}
              </span>
              <span className={`truncate text-sm font-semibold ${active ? "" : "hidden text-muted sm:inline"}`}>{label}</span>
            </button>
            {n < STEP_LABELS.length && <span className="h-0.5 flex-1 bg-[#111318]/20" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
