import Link from "next/link";

/**
 * The one way to start a deal: a sticker-style button to /create, used in the header and on
 * every page that offers it, so they look and behave the same. `short` is the "+" alone on phones.
 */
export function CreateDealButton({ short = false, className = "" }: { short?: boolean; className?: string }) {
  return (
    <Link
      href="/create"
      aria-label={short ? "Create deal" : undefined}
      className={`btn-primary whitespace-nowrap !pl-2.5 ${short ? "max-sm:!pr-2.5" : ""} ${className}`.trim()}
    >
      <span className="btn-plus" aria-hidden>
        +
      </span>
      <span className={short ? "hidden sm:inline" : undefined}>Create deal</span>
    </Link>
  );
}
