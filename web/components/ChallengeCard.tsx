"use client";

import Link from "next/link";
import { ChatIcon, ClockIcon, HeartIcon, LockIcon, PinIcon, TrophyIcon, UsersIcon, XLogoIcon } from "@/components/Icons";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useChallenge } from "@/hooks/useChallenges";
import type { Phase, PublicChallenge, PublicEntry } from "@/lib/challenges";
import type { ClubInfo } from "@/lib/clubs";
import { ago, countdown, untilLabel } from "@/lib/format";
import type { SystemEvent } from "@/lib/systemFeed";

export const PLACES = ["1st", "2nd", "3rd"];

export const PHASE: Record<Phase, string> = {
  open: "Open",
  closing: "Counting likes",
  judging: "Owner is picking",
  settled: "Finished",
  cancelled: "Cancelled",
};

/** Where a challenge stands, in a sentence: the time left, or when it ended and what happens next. */
export function challengeTiming(c: PublicChallenge, now: number): string {
  const endsAt = Math.floor(c.endsAt / 1000);
  if (c.phase === "open") return `Ends in ${countdown(endsAt - now)}`;
  if (c.phase === "judging" && c.pickBy) return `Ended ${ago(endsAt, now)} · the Owner picks ${untilLabel(Math.floor(c.pickBy / 1000), now)} at the latest`;
  if (c.phase === "cancelled") return "Called off by the Owner";
  return `Ended ${ago(endsAt, now)}`;
}

/** The challenge's own path: its brief and every entry, where members enter. */
export const challengePath = (token: string, id: string) => `/clubs/${token}/challenges/${id}`;

const entriesText = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

/** The band over a challenge: the trophy, what this card is ("New challenge", the Club), and where it stands. */
export function ChallengeBand({ c, heading, club, pinned = false }: { c: PublicChallenge; heading: string; club?: string; pinned?: boolean }) {
  return (
    <header className="challenge-band">
      <span className="challenge-medal" aria-hidden>
        <TrophyIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {pinned && <PinIcon className="mr-1 inline size-3.5 align-[-2px]" aria-label="Pinned" />}
        <span className="challenge-kicker">{heading}</span>
        {club && <span className="challenge-club"> · {club}</span>}
      </span>
      <span className="challenge-status" data-phase={c.phase}>
        <i aria-hidden />
        {PHASE[c.phase]}
      </span>
    </header>
  );
}

/**
 * What each place pays, as a medal tile: gold, silver and bronze, the points large. Once settled,
 * each tile names its winner, or says the place went unawarded.
 */
export function PrizeTiles({ c }: { c: PublicChallenge }) {
  const winners = new Map(c.settled?.winners.map((w) => [w.place, w]));
  return (
    <ol className="challenge-prizes" aria-label="Prizes" style={{ "--places": c.prizes.length } as React.CSSProperties}>
      {c.prizes.map((points, i) => {
        const place = i + 1;
        const winner = winners.get(place);
        const unawarded = !!c.settled && !winner;
        return (
          <li key={place} className="challenge-prize" data-place={place} data-unawarded={unawarded || undefined}>
            <span className="challenge-prize-head">
              <span className="challenge-place" data-place={place} aria-hidden>
                {place}
              </span>
              {PLACES[i]}
            </span>
            <span className="challenge-points">
              +{points}
              <small>pts</small>
            </span>
            {winner ? (
              <span className="challenge-winner">
                <WalletAvatar seed={winner.wallet} size="1rem" />
                <span className="truncate">
                  <Who address={winner.wallet} plain />
                </span>
              </span>
            ) : (
              unawarded && <span className="challenge-prize-note">Not awarded</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** How far through its run an open challenge is, with the time left and the entries so far. */
export function ChallengeClock({ c, now }: { c: PublicChallenge; now: number }) {
  const start = c.startsAt / 1000;
  const end = c.endsAt / 1000;
  const done = c.phase === "open" ? Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start))) : 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-bold">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <ClockIcon className="size-3.5 shrink-0" />
          <span className="truncate">{challengeTiming(c, now)}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-muted">
          <ChatIcon className="size-3.5" />
          {entriesText(c.entryCount)}
        </span>
      </div>
      {c.phase !== "cancelled" && (
        <div className="challenge-time" data-phase={c.phase} role="presentation">
          <i style={{ width: `${done * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** Who decides, and who may enter, as quiet facts. */
export function ChallengeFacts({ c }: { c: PublicChallenge }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-muted">
      <span className="inline-flex items-center gap-1">
        {c.judging === "likes" ? <HeartIcon className="size-3.5" /> : <UsersIcon className="size-3.5" />}
        {c.judging === "likes" ? "Most liked wins" : "Owner picks"}
      </span>
      <span className="inline-flex items-center gap-1">
        <XLogoIcon className="size-3" />
        Enter with an X post
      </span>
      {c.holdersOnly && (
        <span className="inline-flex items-center gap-1">
          <LockIcon className="size-3.5" />
          Holders only
        </span>
      )}
    </span>
  );
}

/** Why nobody won, when nobody did. */
export function noWinnerText(c: PublicChallenge): string | null {
  if (!c.settled || c.settled.winners.length > 0) return null;
  return c.settled.expired ? "The Owner didn’t pick in time, so nobody won." : "Nobody won: no entry had a like from another member.";
}

/** The badge at the start of an entry's row: its medal once it placed, its rank while likes decide, else nothing. */
export function EntryRank({ e, c, rank }: { e: PublicEntry; c: PublicChallenge; rank: number }) {
  if (e.place) {
    return (
      <span className="challenge-place challenge-place-sm" data-place={e.place} aria-label={`${PLACES[e.place - 1]} place`}>
        {e.place}
      </span>
    );
  }
  if (c.judging === "likes" && !c.settled && e.likes > 0) {
    return (
      <span className="challenge-rank" aria-label={`Ranked ${rank}`}>
        {rank}
      </span>
    );
  }
  return <span className="challenge-rank" data-none aria-hidden />;
}

/**
 * A challenge as a card of its own (ADR 0045): not a line among the Club's system messages. A band
 * with the trophy and where it stands, the title and brief, the prizes as medal tiles, the time left,
 * the entries leading, and the way into its page. Used on the Challenges tab, the Board (pinned on
 * top while it runs) and the timeline. `compact` leaves the entries out, for several pinned at once.
 */
export function ChallengeSummary({
  c,
  token,
  now,
  club,
  heading = "Challenge",
  pinned = false,
  compact = false,
}: {
  c: PublicChallenge;
  token: string;
  now: number;
  club?: ClubInfo;
  heading?: string;
  pinned?: boolean;
  compact?: boolean;
}) {
  const href = challengePath(token, c.id);
  const leading = compact ? [] : c.entries.slice(0, 3);
  const none = noWinnerText(c);
  return (
    <article className="club-panel challenge-card" aria-label={`Challenge: ${c.title}`}>
      <ChallengeBand c={c} heading={heading} club={club?.name} pinned={pinned} />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <h3 className="challenge-title text-lg">
            <Link href={href} className="challenge-link">
              {c.title}
            </Link>
          </h3>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{c.brief}</p>
        </div>
        <PrizeTiles c={c} />
        {none && <p className="text-sm font-semibold text-muted">{none}</p>}
        <ChallengeClock c={c} now={now} />
        {leading.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="kicker">{c.settled ? "Top entries" : c.judging === "likes" ? "Leading" : "Latest entries"}</p>
            <ul className="challenge-entries" aria-label="Entries">
              {leading.map((e, i) => (
                <li key={e.post}>
                  <EntryRank e={e} c={c} rank={i + 1} />
                  <WalletAvatar seed={e.wallet} size="1.6rem" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold">
                      <Who address={e.wallet} mine={e.mine} plain />
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-sm text-muted">
                      {e.x && <XLogoIcon className="size-3 shrink-0" />}
                      <span className="truncate">{e.text === null ? "Hidden" : (e.x?.text ?? e.text)}</span>
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-muted" aria-label={`${e.likes} likes`}>
                    <HeartIcon className="size-3.5" filled={e.liked} />
                    {e.likes}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="challenge-foot">
        <ChallengeFacts c={c} />
        <Link href={href} className={`${c.phase === "open" && !c.mine ? "btn-primary" : "btn-secondary"} btn-sm shrink-0`}>
          {c.phase === "open" ? (c.mine ? "See your entry" : "Enter") : "See the entries"}
        </Link>
      </footer>
    </article>
  );
}

/**
 * A challenge in a feed (the Board, the timeline): the start or the result of one, read from the
 * system feed's event and drawn as the challenge's own card, with its entries as they are now.
 */
export function ChallengeFeedCard({ event, now, clubs, className = "" }: { event: SystemEvent; now: number; clubs?: (token: string) => ClubInfo | undefined; className?: string }) {
  const token = event.clubs[0] ?? "";
  const { challenge } = useChallenge(token, event.challenge);
  if (!challenge) return null;
  return (
    <li className={`list-none ${className}`}>
      <ChallengeSummary c={challenge} token={token} now={now} club={clubs?.(token)} heading={event.kind === "winner" ? "Challenge results" : "New challenge"} />
    </li>
  );
}
