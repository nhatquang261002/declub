import Link from "next/link";

/**
 * The one way to start a deal: a sticker-style button to /create, used in the header and on
 * every page that offers it, so they look and behave the same. `short` drops "deal" on phones.
 */
export function CreateDealButton({ short = false, className = "" }: { short?: boolean; className?: string }) {
  return (
    <Link href="/create" className={`btn-primary whitespace-nowrap !pl-2.5 ${className}`.trim()}>
      <span className="btn-plus" aria-hidden>+</span>
      <span>
        Create<span className={short ? "hidden sm:inline" : undefined}>&nbsp;deal</span>
      </span>
    </Link>
  );
}
