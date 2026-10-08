"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon, CheckIcon, SwapIcon } from "./Icons";
import { countdown } from "./DealParts";
import { Who } from "./Who";

/**
 * The pieces of a deal's page (globals.css, "Deals"): a sheet with a stamped status, the two
 * sides on a stage, the terms as facts, and a dock with what this wallet can do next. Locked
 * deals and signed swaps all build their page from these, so they read as one thing.
 */

/** What a stamp can show. Locked deals use their display status; signed swaps map onto these. */
export type StampStatus = "open" | "expired" | "filled" | "cancelled" | "rejected";

const STAMP_NOTE: Record<StampStatus, string> = {
  open: "ready to swap",
  expired: "time's up",
  filled: "settled on-chain",
  cancelled: "called off",
  rejected: "refused",
};

export function DealStamp({ status, label, note }: { status: StampStatus; label: string; note?: string }) {
  return (
    // Keyed by status so the stamp lands again when it changes (say, the moment a deal fills).
    <span key={status} className="deal-stamp" data-status={status} role="status">
      {label}
      <small>{note ?? STAMP_NOTE[status]}</small>
    </span>
  );
}

export function BackToDeals() {
  return (
    <Link href="/deals" className="mb-4 inline-flex items-center gap-1.5 rounded-full px-1 text-sm font-bold text-muted transition-colors hover:text-accent">
      <ArrowLeftIcon className="size-4" />
      All deals
    </Link>
  );
}

export function DealSheet({ children }: { children: ReactNode }) {
  return <section className="deal-sheet">{children}</section>;
}

/** Kind chips, the big title, who made it, and the stamp on the right. */
export function DealSheetHead({ chips, title, byline, stamp }: { chips?: ReactNode; title: ReactNode; byline?: ReactNode; stamp: ReactNode }) {
  return (
    <header className="deal-sheet-head">
      <div className="min-w-0 space-y-3">
        {chips && <div className="flex flex-wrap items-center gap-1.5">{chips}</div>}
        <h1 className="deal-title">{title}</h1>
        {byline && <div className="text-sm text-muted">{byline}</div>}
      </div>
      <div className="pt-1 pr-1 sm:pt-3">{stamp}</div>
    </header>
  );
}

/** "Deal #12", with the hash in the accent colour. */
export function DealTitle({ prefix = "Deal", id }: { prefix?: string; id: ReactNode }) {
  return (
    <>
      {prefix} <span className="deal-title-hash">#</span>
      {id}
    </>
  );
}

/** The two sides with a seal between them. `live` turns the seal's ring while it can be taken. */
export function DealStage({ status, live, gives, wants }: { status: StampStatus; live: boolean; gives: ReactNode; wants: ReactNode }) {
  return (
    <div className="deal-stage" data-status={status}>
      {gives}
      <div className="deal-seal" data-status={status} data-live={live ? "" : undefined} aria-hidden>
        <span className="deal-seal-disc">{status === "filled" ? <CheckIcon /> : <SwapIcon />}</span>
      </div>
      {wants}
    </div>
  );
}

/**
 * One side of the stage. `note` says where these assets are (locked, in a wallet); `mine` rings
 * the side the viewer receives, so "what do I get" is the first thing they find.
 */
export function DealStageSide({
  side,
  title,
  note,
  mine = false,
  children,
}: {
  side: "give" | "want";
  title: string;
  note?: ReactNode;
  mine?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="deal-side" data-side={side} data-you={mine ? "" : undefined}>
      <div className="deal-side-head">
        <span className="deal-side-title">{title}</span>
        {note && <span className="deal-side-note">{note}</span>}
      </div>
      <div className="deal-side-body">{children}</div>
    </div>
  );
}

/** Who the viewer is to a deal, if anyone: it decides what each side is called. */
export type Party = "maker" | "taker" | undefined;

/**
 * Each side's title, said once and from where the viewer stands: the maker gives and gets, a
 * taker gets and gives, and anyone else reads it as the maker's deal.
 */
export function sideTitles(party: Party): { give: string; want: string } {
  if (party === "maker") return { give: "You give", want: "You get" };
  if (party === "taker") return { give: "You get", want: "You give" };
  return { give: "Maker gives", want: "Taker gives" };
}

/** The one line under a deal's title: who made it, and how long it has left. */
export function DealByline({
  maker,
  mine,
  verb = "by",
  expiry,
  now,
  live,
}: {
  maker: string;
  mine: boolean;
  verb?: string;
  expiry: bigint;
  now: number;
  /** Still open: only then is time left worth saying. */
  live: boolean;
}) {
  const left = Number(expiry) - now;
  return (
    <p>
      {verb} <Who address={maker} mine={mine} />
      {live && (
        <>
          {" · "}
          {expiry === 0n ? (
            "no expiry"
          ) : (
            <span className={left < 3_600 ? "font-bold text-danger" : "font-semibold text-[#111318]"}>ends in {countdown(expiry, now)}</span>
          )}
        </>
      )}
    </p>
  );
}

type Fact = { label: string; value: ReactNode; hint?: ReactNode };

/** The terms, as a row of facts along the bottom of the sheet. */
export function DealFacts({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="deal-facts">
      {facts.map(({ label, value, hint }) => (
        <div key={label} className="deal-fact">
          <dt>{label}</dt>
          <dd>
            {value}
            {hint && <small>{hint}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Your move": the one place that says what this wallet can do with the deal. `tone` colours
 * its edge: the taker's peach by default, blue for the maker or a settled deal, grey when this
 * wallet can't act, amber when something needs fixing first.
 */
export function DealDock({
  tone,
  eyebrow = "Your move",
  title,
  children,
}: {
  tone?: "maker" | "done" | "blocked" | "warn";
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="deal-dock" data-tone={tone} aria-label={eyebrow}>
      <div className="deal-dock-inner">
        <div className="space-y-1">
          <p className="kicker">{eyebrow}</p>
          <h2 className="deal-dock-title">{title}</h2>
        </div>
        {children}
      </div>
    </section>
  );
}

type Step = { label: string; state: "done" | "current" | "todo" };

/** Where a taker is in accepting: connect, choose, approve, swap. */
export function DealSteps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="deal-steps" aria-label="Steps to accept">
      {steps.map((step, i) => (
        <li key={step.label} className="contents">
          {i > 0 && <span className="deal-step-join" aria-hidden />}
          <span className="deal-step" data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
            <span className="deal-step-dot">{step.state === "done" ? <CheckIcon /> : i + 1}</span>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Steps from a list of [label, done] pairs: the first not done is the current one. */
export function stepsOf(pairs: ReadonlyArray<readonly [string, boolean]>): Step[] {
  const current = pairs.findIndex(([, done]) => !done);
  return pairs.map(([label, done], i) => ({ label, state: done ? "done" : i === current ? "current" : "todo" }));
}
