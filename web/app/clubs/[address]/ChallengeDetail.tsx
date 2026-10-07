"use client";

import { useState } from "react";
import { ChallengeBand, ChallengeClock, ChallengeFacts, EntryRank, PLACES, PrizeTiles, noWinnerText } from "@/components/ChallengeCard";
import { HeartIcon, LockIcon } from "@/components/Icons";
import { Spinner } from "@/components/Spinner";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useChallengeActions } from "@/hooks/useChallenges";
import { useClubActions } from "@/hooks/useClubBoard";
import { type PublicChallenge, type PublicEntry } from "@/lib/challenges";
import { POST_MAX } from "@/lib/clubPosts";
import { ago } from "@/lib/format";

const field = "input border-2 border-[#111318]/25 bg-white focus:border-[#111318]";

/**
 * One challenge in full (ADR 0045), on its own page: the brief, the prizes and the clock, the box
 * where a member writes their entry, every entry with its likes, and the Owner's place picker and
 * cancel. The Challenges tab and the feeds show it as a card (`ChallengeSummary`) that opens here.
 */
export function ChallengeDetail({
  c,
  token,
  now,
  club,
  owner,
  member,
  holder,
  wallet,
  archived,
}: {
  c: PublicChallenge;
  token: string;
  now: number;
  club?: string;
  owner: boolean;
  member: boolean;
  holder: boolean;
  wallet?: string;
  archived: boolean;
}) {
  const { withdraw, pick, cancel } = useChallengeActions(token);
  // The Owner's picks: place → entry. Giving a place to one entry takes it from any other.
  const [picks, setPicks] = useState<Record<number, string>>({});
  const open = c.phase === "open";
  const picking = owner && c.phase === "judging";
  const chosen = c.prizes.map((_, i) => picks[i + 1]);
  const firstGap = chosen.findIndex((p) => !p);
  const placesOk = chosen[0] !== undefined && (firstGap === -1 || chosen.slice(firstGap).every((p) => !p));
  const none = noWinnerText(c);
  const canEnter = open && member && !owner && !archived;

  return (
    <div className="flex flex-col gap-5">
      <article className="club-panel challenge-card" aria-label={`Challenge: ${c.title}`}>
        <ChallengeBand c={c} heading="Challenge" club={club} />
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-2">
            <h1 className="challenge-title text-2xl sm:text-3xl">{c.title}</h1>
            <p className="whitespace-pre-wrap break-words leading-relaxed">{c.brief}</p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-muted">
              <span className="inline-flex items-center gap-1.5">
                <WalletAvatar seed={c.by} size="1rem" />
                <span>
                  Started by <Who address={c.by} /> {ago(Math.floor(c.startsAt / 1000), now)}
                </span>
              </span>
              <ChallengeFacts c={c} />
            </p>
          </div>
          <PrizeTiles c={c} />
          {none && <p className="text-sm font-semibold text-muted">{none}</p>}
          {c.settled?.epoch !== undefined && c.settled.winners.length > 0 && (
            <p className="text-xs font-bold text-muted">The winners’ points count in epoch {c.settled.epoch}, like any other activity points.</p>
          )}
          <ChallengeClock c={c} now={now} />
        </div>
      </article>

      {canEnter && c.holdersOnly && !holder && (
        <p className="club-panel flex items-center gap-2 px-5 py-4 text-sm font-semibold">
          <LockIcon className="size-4 shrink-0" />
          This challenge is for Holders of the Club’s asset. You can still like entries.
        </p>
      )}
      {canEnter && (!c.holdersOnly || holder) && <Entering c={c} token={token} wallet={wallet} onWithdraw={() => withdraw.mutate(c.id)} withdrawing={withdraw.isPending} />}
      {open && !member && <p className="club-panel px-5 py-4 text-sm font-semibold">Join the Club to enter and to like entries.</p>}

      <section className="club-panel overflow-hidden" aria-labelledby="entries-heading">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-[#111318] px-5 py-3">
          <h2 id="entries-heading" className="text-base font-black">
            Entries <span className="text-muted">{c.entryCount}</span>
          </h2>
          <span className="text-xs font-bold text-muted">
            {picking
              ? "Give each place to one entry, best first."
              : c.judging === "likes"
                ? c.settled
                  ? "Ranked by likes from other members."
                  : "Ranked by likes from other members. Likes lock when it ends."
                : c.settled
                  ? "Placed by the Owner."
                  : "The Owner picks the winners after it ends."}
          </span>
        </header>
        {c.entries.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">{open ? "No entries yet. Be the first." : "Nobody entered."}</p>
        ) : (
          <ul className="divide-y divide-[#111318]/10">
            {c.entries.map((e, i) => (
              <EntryRow
                key={e.post}
                e={e}
                c={c}
                rank={i + 1}
                token={token}
                now={now}
                canLike={member && !archived && open && !e.mine}
                picking={
                  picking
                    ? {
                        place: Number(Object.keys(picks).find((p) => picks[Number(p)] === e.post) ?? 0),
                        set: (place: number) => {
                          const next = Object.fromEntries(Object.entries(picks).filter(([, post]) => post !== e.post));
                          setPicks(place > 0 && picks[place] !== e.post ? { ...next, [place]: e.post } : next);
                        },
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )}
        {picking && c.entries.length > 0 && (
          <footer className="challenge-foot">
            <span className="text-xs font-bold text-muted">Places go in order: 1st first. One place per member.</span>
            <button
              type="button"
              className="btn-primary btn-sm"
              aria-busy={pick.isPending}
              disabled={!placesOk || pick.isPending}
              onClick={() => pick.mutate({ id: c.id, posts: chosen.filter((p): p is string => !!p) })}
            >
              {pick.isPending && <Spinner />}
              Award the points
            </button>
          </footer>
        )}
      </section>

      {owner && !archived && (c.phase === "open" || c.phase === "judging" || c.phase === "closing") && (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs font-bold text-muted underline-offset-2 hover:text-danger hover:underline"
            disabled={cancel.isPending}
            onClick={() => window.confirm("Cancel this challenge? Nobody earns anything from it.") && cancel.mutate(c.id)}
          >
            Cancel this challenge
          </button>
        </div>
      )}
    </div>
  );
}

/** A member's own entry, and the box to write one: it posts to the Board (signed, like any post) and enters it. */
function Entering({ c, token, wallet, onWithdraw, withdrawing }: { c: PublicChallenge; token: string; wallet?: string; onWithdraw: () => void; withdrawing: boolean }) {
  const { post, postStage } = useClubActions(token);
  const { enter } = useChallengeActions(token);
  const [text, setText] = useState("");
  const busy = post.isPending || enter.isPending;
  const length = [...text].length;
  const mine = c.entries.find((e) => e.mine);

  return (
    <form
      className="club-panel flex flex-col gap-3 p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const result = (await post.mutateAsync({ kind: "note", text, wallet })) as { post?: { id: string } };
          if (result.post?.id) await enter.mutateAsync({ id: c.id, post: result.post.id });
          setText("");
        } catch {
          // Both mutations have already told the member what went wrong.
        }
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={`entry-${c.id}`} className="text-base font-black">
          {mine ? "You’re in" : "Your entry"}
        </label>
        <span className="text-xs font-bold text-muted">{mine ? "A new entry replaces yours." : "It’s posted on the Board too, signed by your wallet."}</span>
      </div>
      {mine && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-[#111318] bg-white p-3">
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{mine.text}</p>
          <button type="button" className="btn-secondary btn-sm shrink-0" disabled={withdrawing} onClick={onWithdraw}>
            Withdraw
          </button>
        </div>
      )}
      <textarea
        id={`entry-${c.id}`}
        className={`${field} min-h-24 resize-y`}
        value={text}
        readOnly={busy}
        maxLength={POST_MAX * 2}
        placeholder={mine ? "Write a new entry…" : "Your answer to the challenge…"}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted" role="status">
          {post.isPending ? (postStage === "sending" ? "Signed. Posting it…" : "Confirm in your wallet…") : enter.isPending ? "Entering…" : `${POST_MAX - length} characters left`}
        </span>
        <button type="submit" className="btn-primary btn-sm px-5" aria-busy={busy} disabled={busy || text.trim() === "" || length > POST_MAX}>
          {busy && <Spinner />}
          {mine ? "Sign & replace" : "Sign & enter"}
        </button>
      </div>
    </form>
  );
}

function EntryRow({
  e,
  c,
  rank,
  token,
  now,
  canLike,
  picking,
}: {
  e: PublicEntry;
  c: PublicChallenge;
  rank: number;
  token: string;
  now: number;
  canLike: boolean;
  picking?: { place: number; set: (place: number) => void };
}) {
  const { like } = useClubActions(token);
  return (
    <li className={`flex gap-3 px-5 py-4 ${e.place ? "bg-[#f0b735]/10" : ""}`}>
      <div className="flex flex-col items-center gap-2 pt-1">
        <EntryRank e={e} c={c} rank={rank} />
      </div>
      <WalletAvatar seed={e.wallet} size="2.25rem" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-extrabold">
          <Who address={e.wallet} mine={e.mine} />
          {e.place && <span className="text-xs font-black">{PLACES[e.place - 1]} place</span>}
          <span className="text-xs font-normal text-muted">{ago(Math.floor(e.at / 1000), now)}</span>
        </p>
        <p className={`mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed ${e.text === null ? "italic text-muted" : ""}`}>{e.text ?? "This entry is hidden."}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canLike ? (
            <button
              type="button"
              className={`post-like ${e.liked ? "post-like-on" : ""}`}
              aria-pressed={e.liked}
              aria-label={e.liked ? "Take your like back" : "Like this entry"}
              onClick={() => like.mutate({ id: e.post, like: !e.liked })}
            >
              <HeartIcon filled={e.liked} />
              {e.likes}
            </button>
          ) : (
            <span className="post-like" aria-label={`${e.likes} likes`}>
              <HeartIcon filled={e.liked} />
              {e.likes}
            </span>
          )}
          {picking && (
            <span className="inline-flex items-center gap-1" role="group" aria-label="Place for this entry">
              {c.prizes.map((points, i) => (
                <button
                  key={i}
                  type="button"
                  className={`challenge-pick ${picking.place === i + 1 ? "challenge-pick-on" : ""}`}
                  data-place={i + 1}
                  aria-pressed={picking.place === i + 1}
                  onClick={() => picking.set(i + 1)}
                >
                  {PLACES[i]} · +{points}
                </button>
              ))}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
