import { LogoMark } from "@/components/Logo";
import type { ReactNode } from "react";

/** A titled box in the Club page's side column or Manage tab. */
export function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`club-panel p-5 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="kicker">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** An empty list that says what would be here, and the one thing to do about it. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="club-panel flex flex-col items-center px-6 py-10 text-center">
      <LogoMark className="mb-3 size-14 -rotate-6" />
      <p className="font-extrabold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A few rows standing in for a list that is still loading. */
export function Loading({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="club-panel divide-y divide-[#111318]/10" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-4 motion-reduce:animate-none">
          <span className="size-9 rounded-full bg-[#111318]/10" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-1/3 rounded bg-[#111318]/10" />
            <span className="h-3 w-2/3 rounded bg-[#111318]/10" />
          </span>
        </div>
      ))}
    </div>
  );
}
