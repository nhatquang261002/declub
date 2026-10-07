import { useState, type ReactNode } from "react";
import { isAddress } from "viem";
import { XLogoIcon } from "@/components/Icons";
import { Select } from "@/components/Select";
import { DealSheet, DealStage } from "@/components/DealSheet";
import { Who } from "@/components/Who";
import { useAccessToken } from "@/hooks/useAccessToken";
import { call } from "@/hooks/useClubMembership";
import { PRIVY_APP_ID } from "@/lib/config";
import { EXPIRIES, expiryLabelOf, type Terms } from "@/lib/createFlow";
import { CopyAddress } from "@/components/CopyAddress";
import { PROFILE_LABEL, handleLabel, looksLikeHandle, type HandleMatch } from "@/lib/profiles";

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
      <TakerField label={takerLabel} value={terms.taker} onChange={(taker) => onChange({ ...terms, taker })} />
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

type Lookup = { enabled: boolean; matches?: HandleMatch[]; self?: boolean };

/**
 * "Only this wallet": an address, or (with Privy) someone's X or Discord handle, which is looked up
 * and turned into one of the wallets they share under it (ADR 0017). The deal is always locked to
 * an address; the handle only helps find the right one.
 */
function TakerField({ label, value, onChange }: { label: string; value: string; onChange: (taker: string) => void }) {
  const getToken = useAccessToken();
  const [lookup, setLookup] = useState<{ query: string; data?: Lookup; error?: string }>();
  const [busy, setBusy] = useState(false);

  const text = value.trim();
  const handle = !!PRIVY_APP_ID && looksLikeHandle(text);
  const found = lookup?.query === text ? lookup : undefined;

  async function find() {
    if (!getToken || !handle || busy) return;
    setBusy(true);
    try {
      const data = await call<Lookup>(getToken, "GET", `/api/profiles/lookup?handle=${encodeURIComponent(text)}`);
      setLookup({ query: text, data });
    } catch (error) {
      setLookup({ query: text, error: error instanceof Error ? error.message : "Couldn't look that handle up." });
    } finally {
      setBusy(false);
    }
  }

  const note = (children: ReactNode) => <p className="mt-1 text-xs text-muted">{children}</p>;
  let hint: ReactNode;
  if (!text) hint = note(PRIVY_APP_ID ? "Leave empty to let anyone, or type someone's @handle to find their wallet." : "Leave empty to let anyone.");
  else if (isAddress(text)) hint = note(<>Only <Who address={text} /></>);
  else if (!handle) hint = null;
  else if (!getToken) hint = note("Sign in to find a trader by handle, or enter their wallet address.");
  else if (found?.error) hint = <p className="mt-1 text-xs text-danger">{found.error}</p>;
  else if (found?.data && !found.data.enabled) hint = note("Finding traders by handle is off here. Enter their wallet address.");
  else if (found?.data?.matches?.length) hint = <HandleMatches matches={found.data.matches} onPick={onChange} />;
  else if (found?.data) {
    hint = note(
      found.data.self
        ? "That's your own handle."
        : `Nobody shows a profile as ${text}. Ask them to turn on “Show my X or Discord handle” on their Profile page, or enter their wallet address.`,
    );
  } else hint = note(`Press Find to look up ${text.startsWith("@") ? text : `@${text}`}.`);

  return (
    <div>
      <label className="label" htmlFor="taker">{label}</label>
      <div className="flex gap-2">
        <input
          id="taker"
          className="input font-mono"
          placeholder={PRIVY_APP_ID ? "0x… or @handle" : "0x…"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && handle) {
              e.preventDefault();
              void find();
            }
          }}
        />
        {handle && getToken && (
          <button type="button" className="btn-secondary shrink-0" disabled={busy} onClick={find}>
            {busy ? "Finding…" : "Find"}
          </button>
        )}
      </div>
      {hint}
    </div>
  );
}

/** The wallets found for a handle. Picking one puts its address in the field. */
function HandleMatches({ matches, onPick }: { matches: HandleMatch[]; onPick: (wallet: string) => void }) {
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs text-muted">Pick the wallet they will accept from:</p>
      <ul className="flex flex-col gap-1.5">
        {matches.flatMap((match) =>
          match.wallets.map((wallet) => (
            <li key={`${match.provider}:${wallet}`}>
              <button
                type="button"
                title={wallet}
                className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-line/70 px-3 py-2 text-left text-sm hover:border-mint/60"
                onClick={() => onPick(wallet)}
              >
                <span className="flex items-center gap-1.5">
                  {match.provider === "twitter" && <XLogoIcon className="size-3 shrink-0" />}
                  <span className="font-semibold">{handleLabel(match)}</span>
                  <span className="text-xs text-muted">on {PROFILE_LABEL[match.provider]}</span>
                </span>
                <CopyAddress address={wallet} inLink className="text-xs" />
              </button>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

/**
 * Both sides of the deal in review, on the same stage the deal's own page uses, so the maker
 * sees what takers will see. Pass a `DealStageSide` for each.
 */
export function ReviewStage({ give, want }: { give: ReactNode; want: ReactNode }) {
  return (
    <DealSheet>
      <div className="flex flex-wrap items-center gap-2 px-6 pt-5 sm:px-9">
        <span className="chip chip-peach">Preview</span>
        <span className="text-xs text-muted">How your deal will look to everyone else</span>
      </div>
      <DealStage status="open" live gives={give} wants={want} />
    </DealSheet>
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
  const rows: Array<[string, ReactNode]> = [
    ["Deal type", kindLabel],
    // The taker's shared profile, if any, so the maker sees whose wallet the deal is locked to.
    [whoLabel, taker ? <Who address={taker} plain /> : "Anyone"],
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
