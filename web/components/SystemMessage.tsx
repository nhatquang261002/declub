"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClubAvatar } from "@/components/ClubArt";
import { ExternalIcon, SwapIcon, TagIcon, UsersIcon } from "@/components/Icons";
import { Who } from "@/components/Who";
import type { ClubInfo } from "@/lib/clubs";
import { explorerTx } from "@/lib/config";
import { ago } from "@/lib/format";
import type { SystemEvent, SystemKind } from "@/lib/systemFeed";

const ICONS: Record<SystemKind, (p: { className?: string }) => ReactNode> = { swap: SwapIcon, listing: TagIcon, join: UsersIcon };

/** The wallets of an event, each as a name that opens its profile, joined by "and". */
function Names({ wallets }: { wallets: readonly string[] }) {
  return (
    <>
      {wallets.map((w, i) => (
        <span key={w}>
          {i > 0 && (i === wallets.length - 1 ? " and " : ", ")}
          <Who address={w} />
        </span>
      ))}
    </>
  );
}

/** Where a swap or listing can be looked at: its deal, or for a signed swap its transaction. */
function Where({ event }: { event: SystemEvent }) {
  if (!event.deal) return null;
  if (event.signed) {
    return (
      <a href={explorerTx(event.deal)} target="_blank" rel="noopener noreferrer" className="sys-open">
        Transaction <ExternalIcon className="size-3" />
      </a>
    );
  }
  return (
    <Link href={`/v2/deal/${event.deal}`} className="sys-open">
      Deal #{event.deal} <span aria-hidden>→</span>
    </Link>
  );
}

/**
 * Something that happened in a Club, as a line between posts (ADR 0043): a swap that completed
 * (green), a deal listed (blue), a member who joined (orange), each with its own icon. Nobody wrote
 * it, so it has no author, likes or actions. On the Board (`row`) it is a row of the list; on the
 * timeline (`card`, with the `club` it came from) it is a small card that names its Club.
 */
export function SystemMessage({ event, now, club }: { event: SystemEvent; now: number; club?: ClubInfo }) {
  const Icon = ICONS[event.kind];
  const where = club ? ` in ${club.name}` : "";
  return (
    <li className={`sys sys-${event.kind} ${club ? "sys-card" : "sys-row"}`} data-kind={event.kind}>
      <span className="sys-icon" aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="sys-text">
        {club && <ClubAvatar club={club} className="mr-1.5 inline-grid size-4 align-text-bottom text-[0.4rem]" sizes="16px" />}
        <Names wallets={event.wallets} />
        {event.kind === "swap" && ` swapped${where}`}
        {event.kind === "listing" && ` listed a deal${where}`}
        {event.kind === "join" && (club ? ` joined ${club.name}` : " joined the Club")}
      </span>
      <span className="sys-meta">
        <Where event={event} />
        <time className="sys-time">{ago(event.at, now)}</time>
      </span>
    </li>
  );
}
