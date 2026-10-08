"use client";

import Link from "next/link";
import { useState } from "react";
import { ChallengeBand, ChallengeClock, ChallengeFacts, EntryRank, PLACES, PrizeNotSent, PrizeTiles, noWinnerText, spotsText } from "@/components/ChallengeCard";
import { BadgeCheckIcon, CheckIcon, CoinIcon, ExternalIcon, HeartIcon, LockIcon, TagIcon, TrophyIcon, XLogoIcon } from "@/components/Icons";
import { ChallengeShare } from "@/components/ChallengeShare";
import { XPostCard } from "@/components/PostItem";
import { Spinner } from "@/components/Spinner";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useChallengeActions } from "@/hooks/useChallenges";
import { useClubActions } from "@/hooks/useClubBoard";
import { assetText, isFlat, prizeOverdue, prizeStatus, type PrizeStatus, type PublicChallenge, type PublicEntry, type Winner } from "@/lib/challenges";
import { POST_MAX } from "@/lib/clubPosts";
import { EXPLORER_URL } from "@/lib/config";
import { ago } from "@/lib/format";
import { parseXStatus, postedAtOf } from "@/lib/xPosts";

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
  recheck,
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
  /** Reads the member's Holder badge again, for one who just bought in. */
  recheck?: { run: () => void; busy: boolean };
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="challenge-title min-w-0 text-2xl sm:text-3xl">{c.title}</h1>
              {club && <ChallengeShare c={c} token={token} club={club} wallet={wallet} className="shrink-0" />}
            </div>
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
          {(c.drawBlock !== undefined || c.settled?.draw) && <DrawFacts c={c} />}
          {prizeOverdue(c, now * 1000) && <PrizeNotSent />}
          <ChallengeClock c={c} now={now} />
        </div>
      </article>

      {c.rewards?.asset && c.settled?.winners.some((w) => w.prize) && <Prizes c={c} token={token} now={now} owner={owner && !archived} />}
      {c.settled && c.settled.winners.length > 0 && c.mine && c.settled.winners.some((w) => w.post === c.mine) && (
        <p className="club-panel flex items-center gap-2 px-5 py-4 text-sm font-semibold">
          <TrophyIcon className="size-4 shrink-0" />
          You won: a trophy is on your profile.
        </p>
      )}

      {canEnter && c.holdersOnly && !holder && (
        <div className="club-panel flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          <LockIcon className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 text-sm">
            <b>This challenge is for Holders of the Club’s asset.</b> You can still like entries. Just got one? Your wallets are read again at most once a minute.
          </p>
          {recheck && (
            <button type="button" className="btn-secondary btn-sm shrink-0" aria-busy={recheck.busy} disabled={recheck.busy} onClick={recheck.run}>
              {recheck.busy && <Spinner />}
              Check my wallets
            </button>
          )}
        </div>
      )}
      {canEnter && (!c.holdersOnly || holder) && <Entering c={c} token={token} wallet={wallet} now={now} onWithdraw={() => withdraw.mutate(c.id)} withdrawing={withdraw.isPending} />}
      {open && !member && <p className="club-panel px-5 py-4 text-sm font-semibold">Join the Club to enter and to like entries.</p>}

      <section className="club-panel overflow-hidden" aria-labelledby="entries-heading">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-[#111318] px-5 py-3">
          <h2 id="entries-heading" className="text-base font-black">
            Entries <span className="text-muted">{c.entryCount}</span>
          </h2>
          <span className="text-xs font-bold text-muted">{picking ? "Give each place to one entry, best first." : entriesHint(c)}</span>
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

const STATE_LABEL: Record<PrizeStatus, string> = { owed: "Owed", overdue: "Not sent", sent: "Sent" };

/**
 * The asset prize of a settled challenge (ADR 0050), one row per winner owed some: what, and whether
 * it was sent. The Owner sends it from their own wallet and pastes the transaction; the app checks it
 * on chain. A winner sees their own first.
 */
function Prizes({ c, token, now, owner }: { c: PublicChallenge; token: string; now: number; owner: boolean }) {
  const asset = c.rewards!.asset!;
  const settled = c.settled!;
  const owed = settled.winners.filter((w) => w.prize);
  const mine = owed.find((w) => w.post === c.mine);
  const rows = mine ? [mine, ...owed.filter((w) => w !== mine)] : owed;
  return (
    <section className="club-panel overflow-hidden" aria-labelledby="prizes-heading">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-[#111318] px-5 py-3">
        <h2 id="prizes-heading" className="inline-flex items-center gap-1.5 text-base font-black">
          <CoinIcon className="size-4" />
          Prizes from the Owner
        </h2>
        <span className="text-xs font-bold text-muted">The Owner sends them from their own wallet. The app checks each transfer on chain; it never holds a prize.</span>
      </header>
      {mine && (
        <p className="challenge-prize-row bg-[#f0b735]/10 text-sm font-bold">
          Your prize: {assetText(asset, mine.prize!)} · <PrizeState w={mine} at={settled.at} now={now} />
        </p>
      )}
      <ul>
        {rows.map((w) => (
          <PrizeRow key={w.post} c={c} w={w} token={token} now={now} owner={owner} />
        ))}
      </ul>
    </section>
  );
}

function PrizeState({ w, at, now }: { w: Winner; at: number; now: number }) {
  const state = prizeStatus(w, at, now * 1000) ?? "owed";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="prize-state" data-state={state}>
        {state === "sent" && <CheckIcon className="size-3" />}
        {STATE_LABEL[state]}
      </span>
      {w.sent && (
        <a href={`${EXPLORER_URL}/tx/${w.sent.tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold underline underline-offset-2">
          Transaction
          <ExternalIcon className="size-3" />
        </a>
      )}
    </span>
  );
}

/** One winner's prize, and for the Owner while it's owed, the box to paste the transaction that sent it. */
function PrizeRow({ c, w, token, now, owner }: { c: PublicChallenge; w: Winner; token: string; now: number; owner: boolean }) {
  const { prizeSent } = useChallengeActions(token);
  const [tx, setTx] = useState("");
  const asset = c.rewards!.asset!;
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx.trim());
  return (
    <li className="challenge-prize-row">
      {isFlat(c.judging) ? (
        <span className="challenge-place challenge-place-sm" data-place={1} aria-label="Winner">
          <TrophyIcon className="size-3" />
        </span>
      ) : (
        <span className="challenge-place challenge-place-sm" data-place={w.place} aria-label={`${PLACES[w.place - 1]} place`}>
          {w.place}
        </span>
      )}
      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-extrabold">
        <WalletAvatar seed={w.wallet} size="1.25rem" />
        <Who address={w.wallet} />
      </span>
      <span className="text-sm font-bold">{assetText(asset, w.prize!)}</span>
      <PrizeState w={w} at={c.settled!.at} now={now} />
      {owner && !w.sent && (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) prizeSent.mutate({ id: c.id, post: w.post, tx: tx.trim() }, { onSuccess: () => setTx("") });
          }}
        >
          <input
            className={`${field} min-w-0 flex-1 font-mono text-xs`}
            value={tx}
            placeholder="Transaction hash that sent it (0x…)"
            aria-label={`Transaction that sent the prize to ${w.wallet}`}
            aria-invalid={tx.trim() !== "" && !valid}
            onChange={(e) => setTx(e.target.value)}
          />
          <button type="submit" className="btn-secondary btn-sm" aria-busy={prizeSent.isPending} disabled={!valid || prizeSent.isPending}>
            {prizeSent.isPending && <Spinner />}
            Mark as sent
          </button>
        </form>
      )}
    </li>
  );
}

/** How the entries are ordered and what decides, over the list. */
function entriesHint(c: PublicChallenge): string {
  const done = !!c.settled;
  switch (c.judging) {
    case "likes":
      return done ? "Ranked by likes from other members." : "Ranked by likes from other members. Likes lock when it ends.";
    case "holders":
      return done ? "Ranked by likes from Holders." : "Ranked by likes from Holders: other likes don’t count. Likes lock when it ends.";
    case "owner":
      return done ? "Placed by the Owner." : "The Owner picks the winners after it ends.";
    case "raffle":
      return done ? "Drawn at random from these entries." : "The winners are drawn at random from these entries after it ends.";
    case "first":
      return done ? "The first entries in won." : `In the order they were posted: ${spotsText(c)}. Later ones are next in line if one drops out.`;
    case "everyone":
      return c.minLikes
        ? `Every entry with ${c.minLikes}+ like${c.minLikes === 1 ? "" : "s"} from other members wins${done ? "" : ", up to the limit, earliest first. Likes lock when it ends"}.`
        : `Every entry wins${done ? "" : ", up to the limit, earliest first"}.`;
  }
}

/**
 * A raffle's draw (ADR 0049): the block committed before it existed, and once drawn its hash and
 * the seed, with a line on how anyone can draw it again.
 */
function DrawFacts({ c }: { c: PublicChallenge }) {
  const draw = c.settled?.draw;
  const block = draw?.block ?? c.drawBlock!;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border-2 border-dashed border-[#111318]/30 px-3 py-2.5 text-xs">
      <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-bold">
        <TagIcon className="size-3.5" />
        {draw ? "Drawn with block" : "Will be drawn with block"}
        <a href={`${EXPLORER_URL}/block/${block}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
          #{block.toLocaleString("en-US")}
          <ExternalIcon className="size-3" />
        </a>
        {!draw && <span className="font-semibold text-muted">once it’s final. Nobody knew its hash when it was chosen.</span>}
      </p>
      {draw && (
        <>
          <p className="break-all font-mono text-[0.7rem] text-muted">seed {draw.seed}</p>
          <p className="text-muted">
            How to check: seed = keccak256(block hash ‖ challenge id). Sort the {draw.pool.length} {draw.pool.length === 1 ? "entry" : "entries"} by id and shuffle them with it (<code>drawOrder</code>); the first {c.winners ?? 1} that could still win, won.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * A member's own entry, and the box to make one: an entry is their own X post (ADR 0045), so they
 * post it on X, paste its link and add a line; it is shared to the Board (signed, like any post) and
 * entered.
 */
function Entering({ c, token, wallet, now, onWithdraw, withdrawing }: { c: PublicChallenge; token: string; wallet?: string; now: number; onWithdraw: () => void; withdrawing: boolean }) {
  const { post, postStage } = useClubActions(token);
  const { enter } = useChallengeActions(token);
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const busy = post.isPending || enter.isPending;
  const length = [...text].length;
  const mine = c.entries.find((e) => e.mine);
  const tweet = parseXStatus(link.trim());
  // X post ids carry their own time, so a post made before the challenge is caught here, before signing.
  const postedAt = tweet ? postedAtOf(tweet) : null;
  const tooOld = tweet !== null && (postedAt === null || postedAt < c.startsAt);
  const linkOk = tweet !== null && !tooOld;

  return (
    <form
      className="club-panel flex flex-col gap-3 p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const result = (await post.mutateAsync({ kind: "note", text, link: link.trim(), wallet })) as { post?: { id: string } };
          if (result.post?.id) await enter.mutateAsync({ id: c.id, post: result.post.id });
          setText("");
          setLink("");
        } catch {
          // Both mutations have already told the member what went wrong.
        }
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-black">{mine ? "You’re in" : "Your entry"}</p>
        <span className="text-xs font-bold text-muted">{mine ? "A new entry replaces yours." : "It’s shared on the Board too, signed by your wallet."}</span>
      </div>
      {mine && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-[#111318] bg-white p-3">
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap break-words text-sm">{mine.text}</p>
            {mine.x && <XPostCard id={mine.x.id} card={mine.x} now={now} />}
          </div>
          <button type="button" className="btn-secondary btn-sm shrink-0" disabled={withdrawing} onClick={onWithdraw}>
            Withdraw
          </button>
        </div>
      )}
      <ol className="flex flex-col gap-1 text-xs font-semibold text-muted">
        <li>
          <b className="text-[#111318]">1.</b> Post your entry on X from the X account linked to your{" "}
          <Link href="/profile" className="underline">
            profile
          </Link>
          . Posts made before the challenge started don’t count.
        </li>
        <li>
          <b className="text-[#111318]">2.</b> Paste its link here and add a line for the Board.
        </li>
      </ol>
      <p className="text-xs text-muted">Your entry adds to the Club’s Momentum. What it earns you is the prize: it doesn’t count as an X share or bring you points from its likes, even if you withdraw it.</p>
      <label className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
          <XLogoIcon className="size-3.5" /> Your X post
        </span>
        <input
          className={field}
          value={link}
          readOnly={busy}
          inputMode="url"
          placeholder="https://x.com/you/status/…"
          aria-invalid={link.trim() !== "" && !linkOk}
          onChange={(e) => setLink(e.target.value)}
        />
        {link.trim() !== "" && !tweet && <span className="text-xs font-bold text-danger">That isn’t the link of an X post.</span>}
        {tooOld && <span className="text-xs font-bold text-danger">That X post was made before the challenge started. Post a new one for it.</span>}
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold">A line for the Board</span>
        <textarea
          className={`${field} min-h-16 resize-y`}
          value={text}
          readOnly={busy}
          maxLength={POST_MAX * 2}
          placeholder={mine ? "Say something about your new entry…" : "Say something about your entry…"}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted" role="status">
          {post.isPending ? (postStage === "sending" ? "Signed. Posting it…" : "Confirm in your wallet…") : enter.isPending ? "Entering…" : `${POST_MAX - length} characters left`}
        </span>
        <button type="submit" className="btn-primary btn-sm px-5" aria-busy={busy} disabled={busy || !linkOk || text.trim() === "" || length > POST_MAX}>
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
          {e.place && <span className="text-xs font-black">{isFlat(c.judging) ? "Winner" : `${PLACES[e.place - 1]} place`}</span>}
          <span className="text-xs font-normal text-muted">{ago(Math.floor(e.at / 1000), now)}</span>
        </p>
        <p className={`mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed ${e.text === null ? "italic text-muted" : ""}`}>{e.text ?? "This entry is hidden."}</p>
        {e.x && <XPostCard id={e.x.id} card={e.x} now={now} />}
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
          {c.judging === "holders" && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-muted" aria-label={`${e.votes ?? 0} likes from Holders`}>
              <BadgeCheckIcon className="size-3.5" />
              {e.votes ?? 0} from Holders
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
