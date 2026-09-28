"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";

const NAV = [
  { href: "/", label: "Trades" },
  { href: "/create", label: "Create" },
  { href: "/my-chogs", label: "My Chogs" },
  { href: "/history", label: "History" },
  { href: "/guide", label: "Guide" },
];

export function Header() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/trade/") : pathname.startsWith(href);

  return (
    <header
      className="sticky top-0 z-20 border-b border-line/70 backdrop-blur-xl"
      style={{ background: "var(--surface-overlay)" }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Image
            src="/brand/Horizontal_Chog/Horizontal_Logo_white.svg"
            alt="Chog"
            width={150}
            height={44}
            priority
            className="h-8 w-auto sm:h-9"
          />
          <span className="sr-only">Swap</span>
        </Link>
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                active(item.href) ? "bg-panel-2 text-white" : "text-muted hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
