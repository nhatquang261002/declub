"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";

// Create is a button beside the wallet, not a tab: it starts an action rather than showing a list.
const NAV = [
  { href: "/deals", label: "Deals" },
  { href: "/history", label: "History" },
  { href: "/guide", label: "Guide" },
];

export function Header() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/deals" ? pathname.startsWith("/deal") : pathname.startsWith(href);

  return (
    <header
      className="sticky top-0 z-20 border-b border-line/70 backdrop-blur-xl"
      style={{ background: "var(--surface-overlay)" }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="On Deal home">
          <Logo />
        </Link>
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                active(item.href) ? "bg-white/12 text-white" : "text-white/70 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/create" className="btn-create">
            <span className="btn-create-plus" aria-hidden>+</span>
            <span>
              Create<span className="hidden sm:inline">&nbsp;deal</span>
            </span>
          </Link>
          <NotificationBell />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
