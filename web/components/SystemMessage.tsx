"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SwapIcon, TagIcon, UsersIcon } from "@/components/Icons";
import { useProfile } from "@/hooks/useProfiles";
import { profilePath } from "@/lib/about";
import type { ClubInfo } from "@/lib/clubs";
import { explorerTx } from "@/lib/config";
import { ago, shortAddress } from "@/lib/format";
import { SYSTEM_GROUP_SHOWN, type SystemEvent, type SystemKind } from "@/lib/systemFeed";

const ICONS: Record<SystemKind, (p: { className?: string }) => ReactNode> = { swap: SwapIcon, listing: TagIcon, join: UsersIcon };

/** A wallet as short as it can be said: its shown handle, else the short address. Opens its profile. */
function Name({ address }: { address: string }) {
  const profile = useProfile(address);
  return (
    <Link href={profilePath(address)} className="sys-name" title={address}>
      {profile ? profile.handle : shortAddress(address)}
    </Link>
  );
}

/** What happened, as the words that open the deal (or a signed swap's transaction). */
function Action({ event, children }: { event: SystemEvent; children: ReactNode }) {
  if (!event.deal) return <>{children}</>;
  return event.signed ? (
    <a href={explorerTx(event.deal)} target="_blank" rel="noopener noreferrer" className="sys-action">
      {children}
    </a>
  ) : (
    <Link href={`/v2/deal/${event.deal}`} className="sys-action">
      {children}
    </Link>
  );
}

/** Finds a Club by its lowercase token, for lines that say where they happened. */
type ClubLookup = (token: string) => ClubInfo | undefined;

/** One event on one line: its icon in its colour, who, what (opening the deal), where (with `clubs`), and when. */
function Line({ event, now, clubs }: { event: SystemEvent; now: number; clubs?: ClubLookup }) {
  const Icon = ICONS[event.kind];
  const where = clubs ? event.clubs.flatMap((t) => clubs(t)?.name ?? []).join(", ") : "";
  const [first, second] = event.wallets;
  return (
    <li className={`sys-line sys-${event.kind}`}>
      <span className="sys-icon" aria-hidden>
        <Icon className="size-3" />
      </span>
      <span className="sys-text">
        {first && <Name address={first} />}
        {event.kind === "swap" && second && (
          <>
            {" ⇄ "}
            <Name address={second} />
          </>
        )}{" "}
        {event.kind === "swap" && <Action event={event}>swapped</Action>}
        {event.kind === "listing" && <Action event={event}>listed a deal</Action>}
        {event.kind === "join" && <span>joined</span>}
        {where && <span className="sys-where"> · {where}</span>}
      </span>
      <time className="sys-time">{ago(event.at, now)}</time>
    </li>
  );
}

/**
 * The run of things that happened between two posts (ADR 0043): swaps (green), new deals (blue) and
 * new members (orange), a line each, the first few shown and the rest behind "more". Nobody wrote
 * them, so there is no author or actions. On the Board it is a row of the list; on the timeline
 * (`clubs` given) a small card whose lines name their Club.
 */
export function SystemGroup({ events, now, clubs }: { events: readonly SystemEvent[]; now: number; clubs?: ClubLookup }) {
  const [open, setOpen] = useState(false);
  const shown = open ? events : events.slice(0, SYSTEM_GROUP_SHOWN);
  const hidden = events.length - shown.length;
  return (
    <li className={`sys ${clubs ? "sys-card" : "sys-row"}`} aria-label="Club activity">
      <ul className="flex flex-col gap-1">
        {shown.map((event) => (
          <Line key={event.id} event={event} now={now} clubs={clubs} />
        ))}
      </ul>
      {(hidden > 0 || open) && events.length > SYSTEM_GROUP_SHOWN && (
        <button type="button" className="sys-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : `+${hidden} more`}
        </button>
      )}
    </li>
  );
}
