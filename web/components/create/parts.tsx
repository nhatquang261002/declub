import type { ReactNode } from "react";
import { Select } from "@/components/Select";
import { EXPIRIES, expiryLabelOf, type Terms } from "@/lib/createFlow";
import { shortAddress } from "@/lib/format";

export function StepHeading({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      {blurb && <p className="mt-1 text-sm text-muted">{blurb}</p>}
    </div>
  );
}

/** Back on the left, the forward action (`children`) on the right, and why it's blocked above. */
export function StepNav({ onBack, hint, children }: { onBack?: () => void; hint?: string | null; children?: ReactNode }) {
  return (
    <div className="space-y-3">
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {onBack ? (
          <button type="button" className="btn-secondary" onClick={onBack}>
            Back
          </button>
        ) : (
          <span />
        )}
        {children}
      </div>
    </div>
  );
}

export function NextButton({ onClick, disabled, children = "Continue" }: { onClick: () => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <button type="button" className="btn-primary min-w-40" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Who can accept, and until when. Step 2 of every deal kind. */
export function TermsFields({ terms, onChange, takerLabel }: { terms: Terms; onChange: (terms: Terms) => void; takerLabel: string }) {
  return (
    <section className="page-section grid gap-6 p-4 md:grid-cols-2">
      <div>
        <label className="label" htmlFor="taker">{takerLabel}</label>
        <input
          id="taker"
          className="input font-mono"
          placeholder="0x…"
          value={terms.taker}
          onChange={(e) => onChange({ ...terms, taker: e.target.value })}
        />
        <p className="mt-1 text-xs text-muted">Leave empty to let anyone.</p>
      </div>
      <div>
        <label className="label" htmlFor="expiry">Expiry</label>
        <Select
          id="expiry"
          value={terms.expiry}
          options={EXPIRIES.map(({ key, label }) => ({ value: key, label }))}
          onChange={(expiry) => onChange({ ...terms, expiry })}
        />
        <p className="mt-1 text-xs text-muted">After this you can take your assets back.</p>
      </div>
    </section>
  );
}

/** One side of the final review. */
export function ReviewCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="page-section space-y-3 p-4">
      <div>
        <h3 className="label !mb-0">{title}</h3>
        {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** The deal kind, who can accept and the expiry, as the final review shows them. */
export function ReviewTerms({ kindLabel, terms, whoLabel }: { kindLabel: string; terms: Terms; whoLabel: string }) {
  const taker = terms.taker.trim();
  const rows: Array<[string, string]> = [
    ["Deal type", kindLabel],
    [whoLabel, taker ? shortAddress(taker) : "Anyone"],
    ["Expires", terms.expiry === "none" ? "Never" : `In ${expiryLabelOf(terms.expiry)}`],
  ];
  return (
    <ReviewCard title="Terms">
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-x-4 text-sm">
            <dt className="text-muted">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </ReviewCard>
  );
}

/**
 * The last card of the flow: a note, the tx status, and Back beside the main action, so the
 * way back and the way forward sit on one row.
 */
export function ConfirmCard({ note, status, onBack, children }: { note: ReactNode; status?: ReactNode; onBack: () => void; children: ReactNode }) {
  return (
    <section className="page-section space-y-4 p-4">
      <p className="text-sm text-muted">{note}</p>
      {status && <div className="space-y-1">{status}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
        {children}
      </div>
    </section>
  );
}
