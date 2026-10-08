"use client";

import Link from "next/link";
import { BadgeCheckIcon, ChatIcon, CheckIcon, ClockIcon, CoinIcon, CrownIcon, HeartIcon, LockIcon, PinIcon, TagIcon, TrophyIcon, UsersIcon, XLogoIcon } from "@/components/Icons";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useChallenge } from "@/hooks/useChallenges";
import { assetShort, assetText, flatPrizeText, isFlat, judgingText, prizeOverdue, type Judging, type Phase, type PublicChallenge, type PublicEntry, type Winner } from "@/lib/challenges";
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

/** Where a challenge stands, in a word or two: a raffle that has ended is being drawn, not counting likes. */
export function phaseLabel(c: Pick<PublicChallenge, "phase" | "judging">): string {
  if (c.phase !== "closing") return PHASE[c.phase];
  return c.judging === "raffle" ? "Drawing" : c.judging === "likes" || c.judging === "holders" ? PHASE.closing : "Settling";
}

/** Where a challenge stands, in a sentence: the time left, or when it ended and what happens next. */
export function challengeTiming(c: PublicChallenge, now: number): string {
  const endsAt = Math.floor(c.endsAt / 1000);
  if (c.phase === "open") return `Ends in ${countdown(endsAt - now)}`;
  if (c.phase === "judging" && c.pickBy) return `Ended ${ago(endsAt, now)} · the Owner picks ${untilLabel(Math.floor(c.pickBy / 1000), now)} at the latest`;
  if (c.phase === "cancelled") return "Called off by the Owner";
  if (c.phase === "closing" && c.judging === "raffle") return `Ended ${ago(endsAt, now)} · drawing the winners`;
  return `Ended ${ago(endsAt, now)}`;
}

/** The challenge's own path: its brief and every entry, where members enter. */
export const challengePath = (token: string, id: string) => `/clubs/${token}/challenges/${id}`;

const entriesText = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

/** "First in": how many of the winning spots the entries so far fill. */
export const spotsText = (c: PublicChallenge) => `${Math.min(c.entries.length, c.winners ?? 1)} of ${c.winners ?? 1} spots taken`;

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
        {phaseLabel(c)}
      </span>
    </header>
  );
}

/**
 * What each place pays, as a medal tile: gold, silver and bronze, the points large. Once settled,
 * each tile names its winner, or says the place went unawarded. A flat challenge (ADR 0049) pays
 * every winner the same, so it is one tile: how many win and what each gets.
 */
export function PrizeTiles({ c }: { c: PublicChallenge }) {
  if (isFlat(c.judging)) return <FlatPrize c={c} />;
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
            <Points points={points} />
            <AssetLine c={c} amount={c.rewards?.asset?.amounts[i]} winner={winner} />
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

/** A prize's points, large, or a trophy when the Owner set none. */
function Points({ points, each = false }: { points: number; each?: boolean }) {
  if (points === 0) {
    return (
      <span className="challenge-points">
        <TrophyIcon className="mr-1 inline size-5 align-[-3px]" />
        Trophy
      </span>
    );
  }
  return (
    <span className="challenge-points">
      +{points}
      <small>pts{each ? " each" : ""}</small>
    </span>
  );
}

/**
 * The asset prize under a tile's points (ADR 0050): "+ 1 NFT", "+ 50 USDC", in the Owner's gift, and
 * once a ranked place is won whether it was sent. Nothing when the place gets none.
 */
function AssetLine({ c, amount, winner, each = false }: { c: PublicChallenge; amount?: string; winner?: Winner; each?: boolean }) {
  const asset = c.rewards?.asset;
  if (!asset || !amount || amount === "0") return null;
  return (
    <span className="challenge-asset" title={`${assetText(asset, amount)}${each ? " for each winner" : ""}, sent by the Owner`}>
      <CoinIcon className="size-3.5 shrink-0" />
      <span className="truncate">
        + {assetShort(asset, amount)}
        {each ? " each" : ""}
      </span>
      {winner?.prize && winner.sent && <CheckIcon className="size-3.5 shrink-0" aria-label="Sent" />}
    </span>
  );
}

/** One tile for a flat prize: "5 winners", "+3 pts each", and once settled who won (the first few, then how many more). */
function FlatPrize({ c }: { c: PublicChallenge }) {
  const n = c.winners ?? c.prizes.length;
  const won = c.settled?.winners ?? [];
  const shown = won.slice(0, 4);
  return (
    <div className="challenge-prizes" aria-label={`Prize: ${flatPrizeText(c)}`} style={{ "--places": 1 } as React.CSSProperties}>
      <div className="challenge-prize challenge-prize-flat" data-place={1} data-unawarded={(!!c.settled && won.length === 0) || undefined}>
        <span className="challenge-prize-head">
          <span className="challenge-place" data-place={1} aria-hidden>
            <TrophyIcon className="size-3" />
          </span>
          {n} winner{n === 1 ? "" : "s"}
        </span>
        <Points points={c.prize ?? c.prizes[0] ?? 0} each={n > 1} />
        <AssetLine c={c} amount={c.rewards?.asset?.amounts[0]} each={n > 1} />
        {shown.length > 0 ? (
          <span className="challenge-winner">
            <span className="flex -space-x-1">
              {shown.map((w) => (
                <WalletAvatar key={w.post} seed={w.wallet} size="1rem" />
              ))}
            </span>
            <span className="truncate">
              <Who address={shown[0]!.wallet} plain />
              {won.length > 1 && ` +${won.length - 1} more`}
            </span>
          </span>
        ) : (
          c.settled && <span className="challenge-prize-note">Not awarded</span>
        )}
      </div>
    </div>
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
          {c.judging === "first" && c.phase === "open" ? spotsText(c) : entriesText(c.entryCount)}
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
        <JudgingIcon judging={c.judging} className="size-3.5" />
        {judgingText(c)}
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

/** The icon of each way of picking winners. */
export function JudgingIcon({ judging, className }: { judging: Judging; className?: string }) {
  const Icon = { likes: HeartIcon, holders: BadgeCheckIcon, owner: CrownIcon, raffle: TagIcon, first: ClockIcon, everyone: UsersIcon }[judging];
  return <Icon className={className} />;
}

/** Why nobody won, when nobody did. */
export function noWinnerText(c: PublicChallenge): string | null {
  if (!c.settled || c.settled.winners.length > 0) return null;
  if (c.settled.expired) return "The Owner didn’t pick in time, so nobody won.";
  switch (c.judging) {
    case "holders":
      return "Nobody won: no entry had a like from a Holder.";
    case "raffle":
      return "Nobody won: there was no entry to draw.";
    case "everyone":
      return c.minLikes ? `Nobody won: no entry reached ${c.minLikes} like${c.minLikes === 1 ? "" : "s"}.` : "Nobody won: nobody entered.";
    case "first":
      return "Nobody won: nobody entered.";
    default:
      return "Nobody won: no entry had a like from another member.";
  }
}

/** What counts for an entry: its likes, or in a Holder vote the likes from Holders. */
export const countOf = (e: PublicEntry, c: Pick<PublicChallenge, "judging">) => (c.judging === "holders" ? (e.votes ?? 0) : e.likes);

/** The badge at the start of an entry's row: its medal once it placed, its rank while likes decide, else nothing. */
export function EntryRank({ e, c, rank }: { e: PublicEntry; c: PublicChallenge; rank: number }) {
  if (e.place && isFlat(c.judging)) {
    // Every winner of a flat prize wins the same: a gold trophy, not a place.
    return (
      <span className="challenge-place challenge-place-sm" data-place={1} aria-label="Winner">
        <TrophyIcon className="size-3" />
      </span>
    );
  }
  if (e.place) {
    return (
      <span className="challenge-place challenge-place-sm" data-place={e.place} aria-label={`${PLACES[e.place - 1]} place`}>
        {e.place}
      </span>
    );
  }
  // "First in": the entries in line for a spot are numbered; the reserves after them aren't.
  if (c.judging === "first" && !c.settled && rank <= (c.winners ?? 1)) {
    return (
      <span className="challenge-rank" aria-label={`Spot ${rank}`}>
        {rank}
      </span>
    );
  }
  if ((c.judging === "likes" || c.judging === "holders") && !c.settled && countOf(e, c) > 0) {
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
  results = false,
}: {
  c: PublicChallenge;
  token: string;
  now: number;
  club?: ClubInfo;
  heading?: string;
  pinned?: boolean;
  compact?: boolean;
  /** Pinned results (ADR 0050): the winning entry, or the winners of a flat prize, drawn out in full. */
  results?: boolean;
}) {
  const href = challengePath(token, c.id);
  const winning = results ? c.entries.filter((e) => e.place !== undefined && (isFlat(c.judging) || e.place === 1)) : [];
  const leading = compact || winning.length > 0 ? [] : c.entries.slice(0, 3);
  const none = noWinnerText(c);
  const unsent = prizeOverdue(c, now * 1000);
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
        {unsent && <PrizeNotSent />}
        {winning.length > 0 && <WinningEntries c={c} entries={winning} />}
        <ChallengeClock c={c} now={now} />
        {leading.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="kicker">{c.settled ? (isFlat(c.judging) ? "Entries" : "Top entries") : c.judging === "likes" || c.judging === "holders" ? "Leading" : c.judging === "first" ? "First in" : "Entries"}</p>
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
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-muted" aria-label={c.judging === "holders" ? `${countOf(e, c)} likes from Holders` : `${e.likes} likes`}>
                    {c.judging === "holders" ? <BadgeCheckIcon className="size-3.5" /> : <HeartIcon className="size-3.5" filled={e.liked} />}
                    {countOf(e, c)}
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

/** Said plainly on a card and a challenge's page when a winner has waited past the due time (ADR 0050). */
export function PrizeNotSent() {
  return (
    <p className="challenge-unsent" role="note">
      <b>Prize not sent.</b> The Owner hasn’t marked a winner’s prize as sent in time.
    </p>
  );
}

/** The winning entry (1st place), or every winner of a flat prize, in full: pinned results (ADR 0050). */
function WinningEntries({ c, entries }: { c: PublicChallenge; entries: PublicEntry[] }) {
  const flat = isFlat(c.judging);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="kicker">{flat ? (entries.length === 1 ? "The winner" : "The winners") : "The winning entry"}</p>
      <ul className="flex flex-col gap-2" aria-label={flat ? "Winners" : "Winning entry"}>
        {entries.slice(0, flat ? 5 : 1).map((e) => (
          <li key={e.post} className="challenge-winning">
            <EntryRank e={e} c={c} rank={e.place ?? 1} />
            <WalletAvatar seed={e.wallet} size={flat ? "1.6rem" : "2.25rem"} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold">
                <Who address={e.wallet} mine={e.mine} plain />
              </span>
              <span className={`flex min-w-0 items-start gap-1 text-sm ${flat ? "text-muted" : ""}`}>
                {e.x && <XLogoIcon className="mt-1 size-3 shrink-0" />}
                <span className={flat ? "truncate" : "line-clamp-3 whitespace-pre-wrap break-words"}>{e.text === null ? "Hidden" : (e.x?.text ?? e.text)}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      {flat && entries.length > 5 && <p className="text-xs font-bold text-muted">and {entries.length - 5} more</p>}
    </div>
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
