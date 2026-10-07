"use client";

import { useState } from "react";
import { ChallengeSummary, PLACES } from "@/components/ChallengeCard";
import { LoadError } from "@/components/ErrorPanel";
import { Spinner } from "@/components/Spinner";
import { useChallengeActions, useChallenges } from "@/hooks/useChallenges";
import { useClubMembership } from "@/hooks/useClubMembership";
import { CHALLENGE_RULES, isLive, type Judging } from "@/lib/challenges";
import { REWARDS_EPOCH_SECONDS, REWARDS_GENESIS } from "@/lib/config";
import { countdown } from "@/lib/format";
import { epochAt, epochWindow } from "@/lib/rewards";
import { Empty, Loading } from "./parts";

const field = "input border-2 border-[#111318]/25 bg-white focus:border-[#111318]";

/**
 * The Club's challenges (ADR 0045): the Owner sets a task at any time, members answer with a post,
 * and the winners earn activity points for the epoch. The Owner's form and a card for each challenge,
 * which opens onto the challenge's own page (`ChallengeDetail`) where its entries are.
 */
export function ClubChallenges({ token, symbol, archived, now }: { token: string; symbol: string; archived: boolean; now: number }) {
  const { enabled, challenges, isLoading, error } = useChallenges(token);
  const me = useClubMembership(token);
  const owner = me.role === "owner" || me.role === "admin";
  const [starting, setStarting] = useState(false);

  if (error && challenges.length === 0) return <LoadError title="Couldn’t load the challenges" error={error} />;
  if (!enabled) return <Empty title="No challenges on this server">This server isn’t keeping Club challenges.</Empty>;
  const active = challenges.filter((c) => isLive(c.phase));
  const past = challenges.filter((c) => !isLive(c.phase));

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
                <li key={c.id}>
                  <ChallengeSummary c={c} token={token} now={now} />
                </li>
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="kicker">Past challenges</h2>
              <ul className="flex flex-col gap-4">
                {past.map((c) => (
                  <li key={c.id}>
                    <ChallengeSummary c={c} token={token} now={now} />
                  </li>
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

