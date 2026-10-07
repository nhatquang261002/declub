"use client";

import Link from "next/link";
import { Fragment } from "react";
import { FlameIcon } from "@/components/Icons";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubStandings } from "@/hooks/useRewards";
import { REWARDS_EPOCH_SECONDS } from "@/lib/config";
import { countdown, formatMon } from "@/lib/format";
import { DEFAULT_CLUB_RULES, PROTOCOL, type ClubRules } from "@/lib/rewards";
import type { StandingRow, StandingsView } from "@/lib/server/standings";
import { Panel } from "./parts";
import { PointsMeter, pts } from "./PointsMeter";

const wei = (s: string | undefined) => BigInt(s ?? "0");
/** Whether the NFTs a Holder held on average (ADR 0040) differ from what they hold now: then both are shown. */
const differs = (r: Pick<StandingRow, "held" | "shares">) => r.held !== undefined && r.held !== Number(r.shares);
const nfts = (r: Pick<StandingRow, "held" | "shares">) => (differs(r) ? `${plural(BigInt(r.shares), "NFT")} · ${r.held} avg` : plural(BigInt(r.shares), "NFT"));
const plural = (n: number | bigint, one: string, many = `${one}s`) => `${n} ${n === 1 || n === 1n ? one : many}`;

/**
 * The running epoch as if it closed now (ADR 0032): the Holder pool so far as the headline, the
 * reader's own place with the one thing that would move them up, then the leaderboard. Every Holder
 * with the Club's points floor is paid (ADR 0040), so the race is against a number, not each other.
 */
export function LiveStandings({ token, symbol, wallet, now, sponsoredBy }: { token: string; symbol: string; wallet?: string; now: number; sponsoredBy?: string }) {
  const { standings: s } = useClubStandings(token, wallet);
  if (!s) return null;
  const sponsored = wei(s.sponsored);
  const rules = s.rules ?? DEFAULT_CLUB_RULES;
  const isPaid = (r: StandingRow) => r.points >= rules.minPoints;
  const paid = s.paid ?? s.rows.filter(isPaid).length;
  // The leaderboard: Holders with points, most first. The paid ones are those at or above the floor.
  const ranked = s.rows.filter((r) => r.points > 0);
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  const firstBelow = rest.findIndex((r) => !isPaid(r));
  const me = wallet?.toLowerCase();
  // The reader's own row when it is further down than the rows shown.
  const mine = s.me && s.me.rank !== null && s.me.rank > s.rows.length ? s.me : null;

  return (
    <Panel title={`Epoch ${s.n} · live`}>
      <div className="grid gap-4 sm:grid-cols-[1fr_15rem] sm:items-end">
        <div>
          <p className="kicker">Holder pool so far</p>
          <p className="mt-1 text-4xl font-black tabular-nums">{formatMon(wei(s.holderPool))}</p>
          <p className="mt-1 text-sm text-muted">
            For every Holder with {rules.minPoints}+ points · {paid} of {plural(s.holders, "Holder")} so far
          </p>
        </div>
        <Closing endsAt={s.endsAt} now={now} />
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t-2 border-[#111318]/10 pt-3">
        <Stat label="Fees so far" value={formatMon(wei(s.fees))} />
        {sponsored > 0n && <Stat label="Sponsored" value={`+ ${formatMon(sponsored)}`} hint={sponsoredBy ? `by ${sponsoredBy}` : "Added to the Holder pool"} />}
        <Stat label="Club fund" value={formatMon(wei(s.fundPool))} hint="For the Owner" />
      </dl>

      {wallet && <MyCard s={s} symbol={symbol} rules={rules} />}

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="kicker">Leaderboard</h3>
        <p className="text-xs text-muted">
          Holders with {rules.minPoints}+ points are paid · bars fill toward {rules.fullBonusPoints} pts
        </p>
      </div>
      {ranked.length === 0 ? (
        <p className="mt-2 rounded-lg bg-[#111318]/5 px-3 py-4 text-center text-sm">
          No Holder has points yet this epoch. Post, like and reply on the Board: a Holder with {rules.minPoints} points is paid, and the first one others back takes #1.
        </p>
      ) : (
        <>
          <ol className="mt-3 grid gap-2.5 sm:grid-cols-3">
            {podium.map((r) => (
              <PodiumCard key={r.wallet} r={r} mine={r.wallet === me} rules={rules} />
            ))}
          </ol>
          {(rest.length > 0 || mine) && (
            <>
              <div className={`mt-4 ${ROW_GRID} px-2 text-[11px] font-semibold uppercase tracking-wide text-muted`} aria-hidden>
                <span className="col-start-3">Holder</span>
                <span className="hidden text-right sm:block">NFTs</span>
                <span className="text-right">
                  Points<span className="sm:hidden"> · est.</span>
                </span>
                <span className="hidden text-right sm:block">Estimate</span>
              </div>
              <ol className="mt-1" start={4}>
                {rest.map((r, i) => (
                  <Fragment key={r.wallet}>
                    {i === firstBelow && (
                      <li className="flex items-center gap-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <span className="flex-1 border-t-2 border-dashed border-[#111318]/25" />
                        Paid from {rules.minPoints} points
                        <span className="flex-1 border-t-2 border-dashed border-[#111318]/25" />
                      </li>
                    )}
                    <Row r={r} mine={r.wallet === me} paid={isPaid(r)} rules={rules} />
                  </Fragment>
                ))}
                {mine && (
                  <>
                    <li className="py-1 text-center text-xs text-muted" aria-hidden>
                      ⋯
                    </li>
                    <Row r={mine} mine paid={isPaid(mine)} rules={rules} />
                  </>
                )}
              </ol>
            </>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-muted">
        Points: each Holder shares out a weekly voice of {rules.voicePerNft} per NFT (up to {rules.voiceCapNfts * rules.voicePerNft}) over the posts and replies they like or
        answer here, and every verified account {PROTOCOL.baseVoice} more across all Clubs (at most {PROTOCOL.baseCapPerReceiver} of anyone’s points); that backing is most of
        anyone’s points. Add {rules.dayPoints} for each day you post, reply or like (up to 7), {PROTOCOL.xShareBase} for each of your own X
        posts about the Club, and {rules.swapPoints} for each swap (up to {rules.swapCapPerEpoch}). Voice and share count the NFTs you held on average over the week, not
        only at close. An estimate, a few minutes old; holdings are read again when the epoch is built, so it can still change.{" "}
        <Link href="/guide/clubs#rewards" className="font-semibold underline underline-offset-2">
          How points work
        </Link>
      </p>
    </Panel>
  );
}

/** Time left in the epoch, with a bar for how far through it is. */
function Closing({ endsAt, now }: { endsAt: number; now: number }) {
  const left = Math.max(0, endsAt - now);
  const done = Math.min(100, Math.max(0, ((REWARDS_EPOCH_SECONDS - left) / REWARDS_EPOCH_SECONDS) * 100));
  const soon = left < 3600 * 6;
  const exact = new Date(endsAt * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return (
    <div title={`Closes ${exact}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="kicker">Closes in</p>
        <p className={`text-lg font-black tabular-nums ${soon ? "text-[#a9282f]" : ""}`}>{left === 0 ? "now" : countdown(left)}</p>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#111318]/12"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(done)}
        aria-label="How much of the epoch has passed"
      >
        <span className={`block h-full ${soon ? "bg-[#a9282f]" : "bg-[#111318]"}`} style={{ width: `${done}%` }} />
      </div>
    </div>
  );
}

function MyCard({ s, symbol, rules }: { s: StandingsView; symbol: string; rules: ClubRules }) {
  const me = s.me;
  if (!me) return null;
  const activity = me.activity;
  const holder = me.rank !== null;
  const days = holder ? me.days : (activity?.days ?? 0);
  const streak = holder ? me.streak : (activity?.streak ?? 0);
  const carried = activity?.carried ?? 0;
  const paid = holder && me.points >= rules.minPoints;

  let hint: string;
  if (!holder) hint = `Hold a ${symbol} NFT to join the race. Posting, liking and replying still build your streak.`;
  else if (me.points === 0)
    hint = `You hold ${plural(BigInt(me.shares), "NFT")} but nothing counted yet. Post, like or reply on the Board today, and write something others will back.`;
  else if (Number(me.gap) > 0) hint = `About ${me.gap} more points and you’re paid: Holders with ${rules.minPoints}+ points share the pool. Posts and replies others back count the most.`;
  else if (me.backers === 0) hint = "Nobody has backed you yet this epoch. Answer someone on the Board: replies people like count the most.";
  else if (streak === 0 && carried > 0) hint = `${plural(rules.streakMinDays - days, "more active day")} keeps your ${carried}-week streak.`;
  else if (days < 7) hint = `Post, reply or like today to make it ${days + 1} of 7 days.`;
  else hint = "Every day this epoch counted. Keep it up.";

  const status = !holder ? (
    <span className="chip">Not a Holder</span>
  ) : paid ? (
    <span className="chip chip-mint">Paid</span>
  ) : me.points === 0 ? (
    <span className="chip">No points yet</span>
  ) : (
    <span className="chip chip-warn">Below {rules.minPoints} points</span>
  );

  return (
    <section className="mt-5 rounded-xl border-2 border-[#111318] bg-white p-4" aria-label="Your place">
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div className="flex flex-col items-start gap-2 sm:border-r-2 sm:border-[#111318]/10 sm:pr-4">
          <p className="kicker">Your place</p>
          <p className="text-4xl leading-none font-black tabular-nums">{holder ? `#${me.rank}` : "—"}</p>
          {status}
          {holder && (
            <div className="mt-1">
              <p className="kicker">If it closed now</p>
              <p className="mt-0.5 text-lg font-black tabular-nums">
                {me.estimate ? `≈ ${formatMon(wei(me.estimate))}` : wei(s.holderPool) === 0n ? "No fees yet" : "Nothing yet"}
              </p>
            </div>
          )}
          <div className="mt-auto flex flex-wrap gap-1.5">
            {holder && <span className="chip">{plural(BigInt(me.shares), "NFT")}</span>}
            {holder && differs(me) && <span className="chip" title="Your voice and your share of the pool count the NFTs you held on average over the week">avg {me.held} this week</span>}
            {(streak > 0 || carried > 0) && (
              <span className="chip chip-peach">
                <FlameIcon />
                {plural(Math.max(streak, carried), "week")}
              </span>
            )}
          </div>
        </div>
        <PointsMeter
          points={holder ? me.points : 0}
          rules={rules}
          days={days}
          xPoints={holder ? me.xPoints : undefined}
          swapPoints={holder ? me.swapPoints : undefined}
          xShares={holder ? me.xShares : undefined}
          backedPoints={holder ? me.backedPoints : undefined}
          backers={holder ? me.backers : undefined}
        />
      </div>
      <p className="mt-4 rounded-lg bg-[#f0b735]/25 px-3 py-2 text-sm font-semibold">{hint}</p>
    </section>
  );
}

const MEDAL = ["bg-[#f0b735]", "bg-[#d9dde3]", "bg-[#d8996a]"];

/** The three leaders as cards: a phone gets them as stacked rows, a wider screen as a podium. */
function PodiumCard({ r, mine, rules }: { r: StandingRow; mine: boolean; rules: ClubRules }) {
  const full = rules.fullBonusPoints;
  const fill = Math.max(3, Math.min(100, (r.points / full) * 100));
  return (
    <li
      className={`relative flex items-center gap-3 rounded-xl border-2 border-[#111318] p-3 sm:flex-col sm:gap-2 sm:pt-5 sm:text-center ${mine ? "bg-[#f0b735]/30" : "bg-white"}`}
    >
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-full border-2 border-[#111318] text-xs font-black tabular-nums sm:absolute sm:-top-3 sm:left-1/2 sm:-translate-x-1/2 ${MEDAL[r.rank - 1] ?? ""}`}
        aria-label={`Rank ${r.rank}`}
      >
        {r.rank}
      </span>
      <span className="sm:mt-1">
        <WalletAvatar seed={r.wallet} size="2.75rem" link />
      </span>
      <span className="min-w-0 flex-1 sm:w-full sm:flex-none">
        <span className={`flex min-w-0 items-center gap-1.5 text-sm sm:justify-center ${mine ? "font-black" : "font-bold"}`}>
          <span className="min-w-0 truncate">
            <Who address={r.wallet as `0x${string}`} />
          </span>
          {mine && <span className="chip chip-dark shrink-0 text-[10px]">You</span>}
          {r.streak >= 2 && (
            <span className="chip chip-peach shrink-0 text-[10px]" aria-label={`${plural(r.streak, "week")} streak`}>
              <FlameIcon />
              {r.streak}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">{nfts(r)}</span>
        <span
          className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#111318]/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={full}
          aria-valuenow={Math.min(full, r.points)}
          aria-label={`${pts(r.points)} of ${full} for the full bonus`}
        >
          <span className="block h-full rounded-full bg-[#111318]" style={{ width: `${fill}%` }} />
        </span>
      </span>
      <span className="shrink-0 text-right sm:text-center">
        <span className="block text-xl leading-none font-black tabular-nums">{pts(r.points)}</span>
        <span className="mt-1.5 inline-block rounded-full bg-[#111318] px-2.5 py-0.5 text-xs font-bold tabular-nums text-[#fff4cf]">
          {r.estimate ? formatMon(wei(r.estimate)) : "—"}
        </span>
      </span>
    </li>
  );
}

// Rank, avatar, holder, [NFTs], points, [estimate]: the header and every row share it so the columns line up.
const ROW_GRID = "grid grid-cols-[1.75rem_1.9rem_minmax(0,1fr)_5.5rem] items-center gap-x-3 sm:grid-cols-[1.75rem_1.9rem_minmax(0,1fr)_3.5rem_4.5rem_7rem]";
const PODIUM = ["bg-[#f0b735]", "bg-[#d9dde3]", "bg-[#d8996a]"];

function Row({ r, mine, paid = true, rules }: { r: StandingRow; mine: boolean; paid?: boolean; rules: ClubRules }) {
  const podium = r.rank <= 3 && r.points > 0;
  const full = rules.fullBonusPoints;
  // The bar is progress to the full bonus, the same scale as "Your place", so it says something when everyone is close.
  const fill = r.points > 0 ? Math.max(3, Math.min(100, (r.points / full) * 100)) : 0;
  return (
    <li className={`${ROW_GRID} rounded-lg px-2 py-2.5 transition-colors ${mine ? "bg-[#f0b735]/30" : "hover:bg-[#111318]/[0.04]"} ${paid ? "" : "opacity-70"}`}>
      <span
        className={`grid size-7 place-items-center rounded-full text-xs font-black tabular-nums ${podium ? `border-2 border-[#111318] ${PODIUM[r.rank - 1]}` : "text-muted"}`}
        aria-label={`Rank ${r.rank}`}
      >
        {r.rank}
      </span>
      <WalletAvatar seed={r.wallet} link />
      <span className="min-w-0">
        <span className={`flex min-w-0 items-center gap-1.5 text-sm ${mine ? "font-black" : "font-semibold"}`}>
          <span className="min-w-0 truncate">
            <Who address={r.wallet as `0x${string}`} />
          </span>
          {mine && <span className="chip chip-dark shrink-0 text-[10px]">You</span>}
          {r.streak >= 2 && (
            <span className="chip chip-peach shrink-0 text-[10px]" aria-label={`${plural(r.streak, "week")} streak`}>
              <FlameIcon />
              {r.streak}
            </span>
          )}
        </span>
        <span
          className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#111318]/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={full}
          aria-valuenow={Math.min(full, r.points)}
          aria-label={`${pts(r.points)} of ${full} for the full bonus`}
        >
          <span className={`block h-full rounded-full ${paid ? "bg-[#111318]" : "bg-[#111318]/40"}`} style={{ width: `${fill}%` }} />
        </span>
        <span className="mt-0.5 block text-[11px] text-muted sm:hidden">{nfts(r)}</span>
      </span>
      <span className="hidden text-right text-xs tabular-nums text-muted sm:block" title={differs(r) ? `${r.held} on average over the week` : undefined}>
        {differs(r) ? `${r.held} avg` : r.shares}
      </span>
      {/* On a phone the estimate sits under the points, so the name keeps its room. */}
      <span className="text-right">
        <span className="block font-black tabular-nums">{pts(r.points)}</span>
        <span className="block text-[11px] tabular-nums text-muted sm:hidden">{r.estimate ? formatMon(wei(r.estimate)) : "—"}</span>
      </span>
      <span className={`hidden text-right text-sm tabular-nums sm:block ${r.estimate ? "font-black" : "text-muted"}`}>{r.estimate ? formatMon(wei(r.estimate)) : "—"}</span>
    </li>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="mt-0.5 font-black tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}
