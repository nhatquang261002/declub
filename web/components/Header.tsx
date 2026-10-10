"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { ChatIcon, ClockIcon, CrossIcon, HelpIcon, ListIcon, SwapIcon, UsersIcon } from "./Icons";
import { LogoMark, Wordmark } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { usePopover } from "./Popover";
import { CreateDealButton } from "@/components/CreateDealButton";

// Create is a button beside the wallet, not a tab: it starts an action rather than showing a list.
const NAV = [
  { href: "/timeline", label: "Timeline", icon: ChatIcon },
  { href: "/clubs", label: "Clubs", icon: UsersIcon },
  { href: "/deals", label: "Deals", icon: SwapIcon },
  { href: "/history", label: "History", icon: ClockIcon },
  { href: "/guide", label: "Guide", icon: HelpIcon },
];

/** Below desktop width the pages sit behind one button, so the header stays a single row. */
function NavMenu({ active }: { active: (href: string) => boolean }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="hdr-anchor lg:hidden" ref={ref}>
      <button
        type="button"
        className="hdr-btn hdr-btn-icon"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? "Close the menu" : "Open the menu"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <CrossIcon className="size-5" /> : <ListIcon className="size-5" />}
      </button>
      {open && (
        <nav className="hdr-pop py-1.5" role="menu">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              className="hdr-pop-item"
              aria-current={active(href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="hdr-pop-icon">
                <Icon />
              </span>
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  // Deal pages (/deal/<id>) and signed swaps (/intent/<hash>) are reached from the deals list, so they belong to the Deals tab.
  const active = (href: string) => (href === "/deals" ? pathname.startsWith("/deal") || pathname.startsWith("/intent") : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-20 border-b border-line/70 backdrop-blur-xl" style={{ background: "var(--surface-overlay)" }}>
      <div className="mx-auto flex max-w-6xl items-center gap-x-8 px-4 py-3 sm:px-6">
        {/* Phones get the mark alone: the name, Create, the bell, the wallet and the menu don't fit one row. */}
        <Link href="/" aria-label="De(al) Club home" className="flex items-center gap-2.5">
          <LogoMark />
          <Wordmark className="hidden text-[1.7rem] sm:inline" />
        </Link>
        <nav className="hidden gap-1 lg:flex">
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
          <CreateDealButton short />
          <NotificationBell />
          <ConnectButton />
          <NavMenu active={active} />
        </div>
      </div>
    </header>
  );
}
