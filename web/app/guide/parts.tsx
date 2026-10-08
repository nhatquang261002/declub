import type { ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, SwapIcon, UsersIcon, XLogoIcon } from "@/components/Icons";
import { SUPPORT_MAILTO, X_HANDLE, X_URL } from "@/lib/contact";

// The Guide has two bases side by side, Clubs (/guide, the app's purpose, so it comes first) and Deals (/guide/deals), and both share this
// frame: a hero with the switch between them, a numbered contents list, and sections that read like a short manual. Button names
// are in bold so they match the screens. docs/07-user-guide.md is the longer version of both.

export const CARD = "rounded-xl border-2 border-[#111318] bg-[#fff4cf]";
export const MUTED = "text-[#4e5968]";

export type GuideSection = { id: string; label: string };
type GuideBase = "deals" | "clubs";

const BASES: ReadonlyArray<{ key: GuideBase; href: string; label: string; icon: ReactNode }> = [
  { key: "clubs", href: "/guide", label: "Clubs", icon: <UsersIcon className="size-4" /> },
  { key: "deals", href: "/guide/deals", label: "Deals", icon: <SwapIcon className="size-4" /> },
];

function BaseSwitch({ base }: { base: GuideBase }) {
  return (
    <nav aria-label="Guides" className="inline-flex rounded-full border-2 border-[#111318] bg-white/50 p-1">
      {BASES.map(({ key, href, label, icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={base === key ? "page" : undefined}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-black transition-colors ${
            base === key ? "bg-[#111318] text-[#fff4cf]" : "text-[#4e5968] hover:text-[#111318]"
          }`}
        >
          {icon}
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function GuideHero({
  base,
  title,
  accent,
  lead,
  actions,
  summary,
  sections,
}: {
  base: GuideBase;
  title: string;
  accent: string;
  lead: string;
  actions: ReactNode;
  summary: readonly string[];
  sections: readonly GuideSection[];
}) {
  return (
    <section className="hero-panel overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <BaseSwitch base={base} />
          <h1 className="mt-6 max-w-2xl text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
            {title}
            <span className="block text-accent">{accent}</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">{lead}</p>
          <div className="mt-7 flex flex-wrap gap-3">{actions}</div>
        </div>
        <ul className={`${CARD} space-y-3 p-5 text-sm lg:w-72`}>
          <li className="text-xs font-black tracking-[0.16em] text-[#a9282f] uppercase">The short version</li>
          {summary.map((line) => (
            <li key={line} className="flex gap-2.5 leading-6">
              <CheckIcon className="mt-1 size-4 shrink-0 text-[#1f7a55]" />
              {line}
            </li>
          ))}
        </ul>
      </div>
      <nav aria-label="Sections" className="flex gap-2 overflow-x-auto border-t border-black/10 px-6 py-4 sm:px-10 lg:hidden">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="shrink-0 rounded-full border-2 border-[#111318] bg-white/60 px-3 py-1 text-sm font-bold hover:bg-white"
          >
            {section.label}
          </a>
        ))}
      </nav>
    </section>
  );
}

/** The contents list beside the sections on wide screens, and the column they sit in. */
export function GuideBody({ sections, children }: { sections: readonly GuideSection[]; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-14">
      <aside className="hidden lg:block">
        <nav aria-label="On this page" className="sticky top-24">
          <p className="text-xs font-black tracking-[0.16em] text-muted uppercase">On this page</p>
          <ol className="mt-4 space-y-1 border-l-2 border-[#111318]/15 text-sm">
            {sections.map((section, i) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="-ml-0.5 flex gap-2 border-l-2 border-transparent py-1.5 pl-4 font-semibold text-muted hover:border-accent hover:text-[#111318]"
                >
                  <span className="w-4 font-mono text-xs leading-5 text-[#a9282f]">{i + 1}</span>
                  {section.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <div className="min-w-0 space-y-16">{children}</div>
    </div>
  );
}

export function Section({
  sections,
  id,
  title,
  intro,
  children,
}: {
  sections: readonly GuideSection[];
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const index = sections.findIndex((section) => section.id === id);
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <header className="mb-6">
        <p className="flex items-center gap-2 text-xs font-black tracking-[0.16em] text-[#a9282f] uppercase">
          <span className="grid size-6 place-items-center rounded-full border-2 border-[#111318] bg-accent text-[11px] tracking-normal text-white">
            {index + 1}
          </span>
          {sections[index]?.label}
        </p>
        <h2 id={`${id}-title`} className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{title}</h2>
        {intro && <p className="mt-2 max-w-2xl leading-7 text-muted">{intro}</p>}
      </header>
      {children}
    </section>
  );
}

/** Small cards in a grid: a title and a line or two each. */
export function CardGrid({ items, cols = 3 }: { items: ReadonlyArray<{ title: string; body: ReactNode; icon?: ReactNode }>; cols?: 2 | 3 }) {
  return (
    <ul className={`grid gap-4 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {items.map((item) => (
        <li key={item.title} className={`${CARD} p-5`}>
          {item.icon && (
            <span className="mb-4 grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-peach">{item.icon}</span>
          )}
          <h3 className="font-black">{item.title}</h3>
          <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Numbered steps in one card, read top to bottom. */
export function Steps({ items }: { items: ReadonlyArray<{ title: string; body: ReactNode }> }) {
  return (
    <ol className={`${CARD} divide-y divide-[#111318]/10`}>
      {items.map((step, i) => (
        <li key={step.title} className="flex gap-4 p-5 sm:p-6">
          <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-accent text-sm font-black text-white">
            {i + 1}
          </span>
          <div>
            <h3 className="font-black">{step.title}</h3>
            <p className={`mt-1 text-sm leading-6 ${MUTED}`}>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Checklist({ items }: { items: readonly string[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((line) => (
        <li key={line} className={`${CARD} flex gap-3 p-4 text-sm leading-6`}>
          <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-mint">
            <CheckIcon className="size-3" />
          </span>
          {line}
        </li>
      ))}
    </ul>
  );
}

export function Faq({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className={`${CARD} divide-y divide-[#111318]/10`}>
      {items.map(([question, answer]) => (
        <details key={question} className="group px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-bold">
            {question}
            <span className="text-xl font-normal text-accent transition-transform group-open:rotate-45" aria-hidden>+</span>
          </summary>
          <p className={`pb-5 pr-8 text-sm leading-6 ${MUTED}`}>{answer}</p>
        </details>
      ))}
    </div>
  );
}

/** The end of a guide: a link to the other one, and how to reach support. */
export function GuideFooter({ other }: { other: { href: string; title: string; body: string } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <Link href={other.href} className={`${CARD} group block p-6 transition-transform hover:-translate-y-0.5`}>
        <p className="text-xs font-black tracking-[0.16em] text-[#a9282f] uppercase">Also in the Guide</p>
        <p className="mt-2 text-xl font-black">
          {other.title} <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">→</span>
        </p>
        <p className={`mt-1 text-sm ${MUTED}`}>{other.body}</p>
      </Link>
      <div className={`${CARD} flex flex-col justify-center gap-3 p-6`}>
        <p className="font-black">Still stuck?</p>
        <a href={SUPPORT_MAILTO} className="btn-secondary">Contact support</a>
        <a href={X_URL} target="_blank" rel="noreferrer" className="btn-secondary">
          <XLogoIcon /> @{X_HANDLE}
        </a>
      </div>
    </div>
  );
}
