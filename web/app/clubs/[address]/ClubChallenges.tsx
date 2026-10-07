"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LoadError } from "@/components/ErrorPanel";
import { HeartIcon, TrophyIcon } from "@/components/Icons";
import { Spinner } from "@/components/Spinner";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useChallengeActions, useChallenges } from "@/hooks/useChallenges";
import { useClubActions } from "@/hooks/useClubBoard";
import { useClubMembership } from "@/hooks/useClubMembership";
import { CHALLENGE_RULES, prizeText, type Judging, type Phase, type PublicChallenge, type PublicEntry } from "@/lib/challenges";
import { POST_MAX } from "@/lib/clubPosts";
import { REWARDS_EPOCH_SECONDS, REWARDS_GENESIS } from "@/lib/config";
import { ago, countdown, untilLabel } from "@/lib/format";
import { epochAt, epochWindow } from "@/lib/rewards";
import { Empty, Loading } from "./parts";

const field = "input border-2 border-[#111318]/25 bg-white focus:border-[#111318]";
const PLACES = ["1st", "2nd", "3rd"];
const PHASE: Record<Phase, { label: string; chip: string }> = {
  open: { label: "Open", chip: "chip-mint" },
  closing: { label: "Counting likes", chip: "chip-blue" },
  judging: { label: "Owner is picking", chip: "chip-warn" },
  settled: { label: "Done", chip: "chip-dark" },
  cancelled: { label: "Cancelled", chip: "" },
};

/**
 * The Club's challenges (ADR 0045): the Owner sets a task at any time, members answer with a post,
 * and the winners earn activity points for the epoch. The Owner's form, each challenge with its entries,
 * and what a member can do with it.
 */
export function ClubChallenges({ token, symbol, archived, now }: { token: string; symbol: string; archived: boolean; now: number }) {
  const { enabled, challenges, isLoading, error } = useChallenges(token);
  const me = useClubMembership(token);
  const owner = me.role === "owner" || me.role === "admin";
  const [starting, setStarting] = useState(false);

  if (error && challenges.length === 0) return <LoadError title="Couldn’t load the challenges" error={error} />;
  if (!enabled) return <Empty title="No challenges on this server">This server isn’t keeping Club challenges.</Empty>;
  const active = challenges.filter((c) => c.phase === "open" || c.phase === "closing" || c.phase === "judging");
  const past = challenges.filter((c) => c.phase === "settled" || c.phase === "cancelled");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          A challenge is a task the Owner sets the Club. Members answer it with a post; the winners earn activity points that count toward their share of the week’s rewards.
        </p>
        {owner && !archived && (
          <button type="button" className="btn-primary btn-sm" aria-expanded={starting} onClick={() => setStarting(!starting)}>
            {starting ? "Close" : "Start a challenge"}
          </button>
        )}
      </div>
      {starting && owner && <StartForm token={token} now={now} onDone={() => setStarting(false)} />}

      {isLoading ? (
        <Loading label="Loading the challenges" />
      ) : challenges.length === 0 ? (
        <Empty title="No challenges yet">{owner ? "Start one: a meme contest, a best pitch, anything the Club can answer with a post." : `When the Owner of ${symbol} sets the Club a challenge, it shows up here.`}</Empty>
      ) : (
        <>
          {active.length > 0 && (
            <ul className="flex flex-col gap-4">
              {active.map((c) => (
                <Card key={c.id} c={c} token={token} now={now} owner={owner} member={!!me.member} holder={!!me.holder} wallet={me.wallet} archived={archived} />
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="kicker">Past challenges</h2>
              <ul className="flex flex-col gap-4">
                {past.map((c) => (
                  <Card key={c.id} c={c} token={token} now={now} owner={owner} member={!!me.member} holder={!!me.holder} wallet={me.wallet} archived={archived} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** The Owner's form: what to do, who decides, how many places pay and how much, and for how long. */
function StartForm({ token, now, onDone }: { token: string; now: number; onDone: () => void }) {
  const { create } = useChallengeActions(token);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [judging, setJudging] = useState<Judging>("likes");
  const [prizes, setPrizes] = useState<string[]>(["10", "", ""]);
  const [epochs, setEpochs] = useState(1);
  const [holdersOnly, setHoldersOnly] = useState(false);
  // It ends when an epoch does: this one, or one of the next few.
  const current = Math.max(0, epochAt(now, REWARDS_GENESIS, REWARDS_EPOCH_SECONDS));
  const endOf = (k: number) => epochWindow(current + k - 1, REWARDS_GENESIS, REWARDS_EPOCH_SECONDS).end;
  const paid = prizes.map(Number).filter((_, i) => prizes[i]!.trim() !== "");
  const ok = paid.length > 0 && paid.every((p, i) => Number.isInteger(p) && p >= 1 && p <= CHALLENGE_RULES.maxPoints && (i === 0 || p <= paid[i - 1]!));
  // A gap ("1st: 10, 2nd: blank, 3rd: 5") isn't a list of places in order.
  const contiguous = prizes.every((p, i) => p.trim() !== "" || prizes.slice(i + 1).every((q) => q.trim() === ""));
  const valid = title.trim() !== "" && brief.trim() !== "" && ok && contiguous;

  return (
    <form
      className="club-panel flex flex-col gap-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ title, brief, judging, prizes: paid, epochs, holdersOnly }, { onSuccess: onDone });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold">Title</span>
        <input className={field} value={title} maxLength={CHALLENGE_RULES.titleMax * 2} placeholder="Best Chog meme of the week" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold">What members should do</span>
        <textarea
          className={`${field} min-h-20 resize-y`}
          value={brief}
          maxLength={CHALLENGE_RULES.briefMax * 2}
          placeholder="Post your funniest Chog. Original work only."
          onChange={(e) => setBrief(e.target.value)}
        />
        <span className="text-xs text-muted">At most {CHALLENGE_RULES.briefMax} characters.</span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">Who picks the winners</legend>
        {(
          [
            ["likes", "The Club, by likes", "Entries are ranked by likes from other members. Likes lock when it ends."],
            ["owner", "You", `After it ends you have ${CHALLENGE_RULES.pickWindowMs / 86_400_000} days to pick, or it ends with no winners.`],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="judging" className="mt-1" checked={judging === value} onChange={() => setJudging(value)} />
            <span>
              <b>{label}</b>
              <span className="block text-xs text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <p className="text-sm font-bold">Points for each place</p>
        <div className="mt-1 grid grid-cols-3 gap-3">
          {PLACES.map((place, i) => (
            <label key={place} className="flex flex-col gap-1">
              <span className="text-xs text-muted">{place}{i > 0 ? " (optional)" : ""}</span>
              <input
                className={`${field} tabular-nums`}
                inputMode="numeric"
                value={prizes[i]}
                aria-label={`Points for ${place} place`}
                onChange={(e) => setPrizes(prizes.map((p, j) => (j === i ? e.target.value : p)))}
              />
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          Whole points, up to {CHALLENGE_RULES.maxPoints} a place, a lower place never more than a higher one. They count like any other activity points. A member counts at most 20 challenge points an epoch.
        </p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold">Ends with</span>
        <select className={field} value={epochs} onChange={(e) => setEpochs(Number(e.target.value))}>
          {Array.from({ length: CHALLENGE_RULES.maxEpochs }, (_, i) => i + 1).map((k) => (
            <option key={k} value={k} disabled={endOf(k) - now < CHALLENGE_RULES.minHours * 3600}>
              {k === 1 ? "This epoch" : k === 2 ? "The next epoch" : `Epoch ${current + k - 1}`} · in {countdown(endOf(k) - now)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">A challenge ends when an epoch does, and likes-judged winners’ points count in that epoch.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={holdersOnly} onChange={(e) => setHoldersOnly(e.target.checked)} />
        <span>
          <b>Only Holders can enter</b>
          <span className="block text-xs text-muted">Members who hold the Club’s asset (the Holder badge). Anyone can still like.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" aria-busy={create.isPending} disabled={!valid || create.isPending}>
          {create.isPending && <Spinner />}
          {create.isPending ? "Starting…" : "Start the challenge"}
        </button>
        <span className="text-xs text-muted">It starts now and is logged. You can’t enter your own challenge, and you can cancel it until it’s settled.</span>
      </div>
    </form>
  );
}

function Card({ c, token, now, owner, member, holder, wallet, archived }: { c: PublicChallenge; token: string; now: number; owner: boolean; member: boolean; holder: boolean; wallet?: string; archived: boolean }) {
  const { withdraw, pick, cancel } = useChallengeActions(token);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const phase = PHASE[c.phase];
  const endsAt = Math.floor(c.endsAt / 1000);
  const open = c.phase === "open";
  const chosen = Object.entries(picks)
    .filter(([, place]) => place > 0)
    .sort(([, a], [, b]) => a - b);
  const placesOk = chosen.length > 0 && chosen.every(([, place], i) => place === i + 1);

  return (
    <li className="club-panel flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <TrophyIcon className="size-5 shrink-0" />
            <span className="min-w-0 break-words">{c.title}</span>
          </h3>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.brief}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip px-2.5 py-1 text-xs ${phase.chip}`}>{phase.label}</span>
          <span className="chip px-2.5 py-1 text-xs">{prizeText(c.prizes)}</span>
          {c.holdersOnly && <span className="chip chip-blue px-2.5 py-1 text-xs">Holders only</span>}
        </div>
      </div>
      <p className="text-xs text-muted">
        {open
          ? `Ends in ${countdown(endsAt - now)}`
          : c.phase === "judging" && c.pickBy
            ? `Ended ${ago(endsAt, now)}. The Owner picks ${untilLabel(Math.floor(c.pickBy / 1000), now)} at the latest.`
            : c.phase === "cancelled"
              ? "Called off by the Owner."
              : `Ended ${ago(endsAt, now)}`}
        {" · "}judged by {c.judging === "likes" ? "likes from the Club" : "the Owner"}
        {" · "}
        {c.entryCount} {c.entryCount === 1 ? "entry" : "entries"}
      </p>
      {c.settled && (
        <p className="rounded-lg bg-[#f0b735]/25 px-3 py-2 text-sm font-semibold">
          {c.settled.winners.length > 0
            ? `${c.settled.winners.length === 1 ? "Winner" : "Winners"}: ${c.settled.winners.map((w) => `${PLACES[w.place - 1]} +${w.points} pts`).join(", ")}. Counted in epoch ${c.settled.epoch}.`
            : c.settled.expired
              ? "The Owner didn’t pick in time, so nobody won."
              : "Nobody won: no entry had a like from another member."}
        </p>
      )}

      {open && member && !owner && !archived && c.holdersOnly && !holder && (
        <p className="text-sm text-muted">This challenge is for Holders. You can still like entries.</p>
      )}
      {open && member && !owner && !archived && (!c.holdersOnly || holder) && (
        <Entering c={c} token={token} wallet={wallet} onWithdraw={() => withdraw.mutate(c.id)} withdrawing={withdraw.isPending} />
      )}
      {open && !member && <p className="text-sm text-muted">Join the Club to enter.</p>}

      {c.entries.length > 0 && (
        <ul className="-mx-5 divide-y divide-[#111318]/10 border-y border-[#111318]/10">
          {c.entries.map((e) => (
            <EntryRow
              key={e.post}
              e={e}
              c={c}
              token={token}
              now={now}
              canLike={member && !archived && c.phase === "open" && !e.mine}
              picking={owner && c.phase === "judging" ? { place: picks[e.post] ?? 0, set: (place: number) => setPicks({ ...picks, [e.post]: place }) } : undefined}
            />
          ))}
        </ul>
      )}

      {owner && c.phase === "judging" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary btn-sm"
            aria-busy={pick.isPending}
            disabled={!placesOk || chosen.length > c.prizes.length || pick.isPending}
            onClick={() => pick.mutate({ id: c.id, posts: chosen.map(([post]) => post) })}
          >
            {pick.isPending && <Spinner />}
            Award the points
          </button>
          <span className="text-xs text-muted">Give 1st{c.prizes.length > 1 ? `${c.prizes.length > 2 ? ", 2nd and 3rd" : " and 2nd"} if you like` : ""} to an entry. Places go in order, one per member.</span>
        </div>
      )}
      {owner && !archived && (c.phase === "open" || c.phase === "judging" || c.phase === "closing") && (
        <div>
          <button
            type="button"
            className="text-xs font-bold text-muted hover:text-danger"
            disabled={cancel.isPending}
            onClick={() => window.confirm("Cancel this challenge? Nobody earns anything from it.") && cancel.mutate(c.id)}
          >
            Cancel this challenge
          </button>
        </div>
      )}
    </li>
  );
}

/** A member's own entry, or the box to write one: it posts to the Board (signed, like any post) and enters it. */
function Entering({ c, token, wallet, onWithdraw, withdrawing }: { c: PublicChallenge; token: string; wallet?: string; onWithdraw: () => void; withdrawing: boolean }) {
  const { post, postStage } = useClubActions(token);
  const { enter } = useChallengeActions(token);
  const [text, setText] = useState("");
  const busy = post.isPending || enter.isPending;
  const length = [...text].length;
  const mine = c.entries.find((e) => e.mine);

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border-2 border-[#111318]/15 bg-white p-3"
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
      {mine && (
        <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <b>You’re in.</b> A new entry replaces yours.
          </span>
          <button type="button" className="btn-secondary btn-sm" disabled={withdrawing} onClick={onWithdraw}>
            Withdraw
          </button>
        </p>
      )}
      <label className="sr-only" htmlFor={`entry-${c.id}`}>
        Your entry
      </label>
      <textarea
        id={`entry-${c.id}`}
        className={`${field} min-h-16 resize-y`}
        value={text}
        readOnly={busy}
        maxLength={POST_MAX * 2}
        placeholder="Your entry. It’s posted on the Board too."
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted" role="status">
          {post.isPending ? (postStage === "sending" ? "Signed. Posting it…" : "Confirm in your wallet…") : enter.isPending ? "Entering…" : `${POST_MAX - length} characters left`}
        </span>
        <button type="submit" className="btn-primary btn-sm px-5" aria-busy={busy} disabled={busy || text.trim() === "" || length > POST_MAX}>
          {busy && <Spinner />}
          Sign &amp; enter
        </button>
      </div>
    </form>
  );
}

function EntryRow({
  e,
  c,
  token,
  now,
  canLike,
  picking,
}: {
  e: PublicEntry;
  c: PublicChallenge;
  token: string;
  now: number;
  canLike: boolean;
  picking?: { place: number; set: (place: number) => void };
}) {
  const { like } = useClubActions(token);
  const queryClient = useQueryClient();
  const place = e.place ? PLACES[e.place - 1] : undefined;
  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-3">
      <WalletAvatar seed={e.wallet} size="2rem" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <Who address={e.wallet} mine={e.mine} />
          {place && <span className="chip chip-peach px-2 py-0.5 text-xs">{place}</span>}
          <span className="text-xs font-normal text-muted">{ago(Math.floor(e.at / 1000), now)}</span>
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{e.text}</p>
      </div>
      <div className="flex items-center gap-2">
        {canLike ? (
          <button
            type="button"
            className={`chip px-2.5 py-1 text-xs ${e.liked ? "chip-peach" : "hover:bg-white"}`}
            aria-pressed={e.liked}
            aria-label={e.liked ? "Take your like back" : "Like this entry"}
            onClick={() =>
              like.mutate({ id: e.post, like: !e.liked }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["club-challenges", token.toLowerCase()] }) })
            }
          >
            <HeartIcon filled={e.liked} />
            {e.likes}
          </button>
        ) : (
          <span className="chip px-2.5 py-1 text-xs" aria-label={`${e.likes} likes`}>
            <HeartIcon />
            {e.likes}
          </span>
        )}
        {picking && (
          <select className={`${field} w-24 py-1 text-sm`} aria-label="Place for this entry" value={picking.place} onChange={(ev) => picking.set(Number(ev.target.value))}>
            <option value={0}>—</option>
            {c.prizes.map((_, i) => (
              <option key={i} value={i + 1}>
                {PLACES[i]}
              </option>
            ))}
          </select>
        )}
      </div>
    </li>
  );
}
