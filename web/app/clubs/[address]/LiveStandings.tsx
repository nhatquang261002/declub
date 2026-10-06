"use client";

import { FlameIcon } from "@/components/Icons";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubStandings } from "@/hooks/useRewards";
import { REWARDS_EPOCH_SECONDS } from "@/lib/config";
import { countdown, formatMon } from "@/lib/format";
import { REWARDS, percent } from "@/lib/rewards";
import type { StandingRow, StandingsView } from "@/lib/server/standings";
import { Panel } from "./parts";

const wei = (s: string | undefined) => BigInt(s ?? "0");
const plural = (n: number | bigint, one: string, many = `${one}s`) => `${n} ${n === 1 || n === 1n ? one : many}`;

/**
 * The running epoch as if it closed now (ADR 0032): the pool so far, the race for the paid places,
 * and the reader's own card with the one thing that would move them up.
 */
export function LiveStandings({ token, symbol, wallet, now }: { token: string; symbol: string; wallet?: string; now: number }) {
  const { standings: s } = useClubStandings(token, wallet);
  if (!s) return null;
  const top = s.rows.slice(0, REWARDS.maxHolders);
  const next = s.rows[REWARDS.maxHolders];

  return (
    <Panel title="This epoch · live">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Figure label="Fees so far" value={formatMon(wei(s.fees))} />
        <Figure label="Holder pool" value={formatMon(wei(s.holderPool))} hint={`${plural(s.holders, "Holder")} in the race`} />
        <Figure label="Club fund" value={formatMon(wei(s.fundPool))} />
        <Closing endsAt={s.endsAt} now={now} />
      </dl>

      {wallet && <MyCard s={s} symbol={symbol} />}

      {top.length > 0 && (
        <ol className="mt-4 divide-y divide-[#111318]/10">
          {top.map((r) => (
            <Row key={r.wallet} r={r} mine={r.wallet === wallet?.toLowerCase()} />
          ))}
          {next && (
            <>
              <li className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">Paid places end here</li>
              <Row r={next} mine={next.wallet === wallet?.toLowerCase()} />
            </>
          )}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted">An estimate, a few minutes old: holdings are read again and everything can change before the epoch closes.</p>
    </Panel>
  );
}

/** When the epoch closes, as a figure like the others: time left, with a bar for how far through it is. */
function Closing({ endsAt, now }: { endsAt: number; now: number }) {
  const left = Math.max(0, endsAt - now);
  const done = Math.min(100, Math.max(0, ((REWARDS_EPOCH_SECONDS - left) / REWARDS_EPOCH_SECONDS) * 100));
  const soon = left < 3600 * 6;
  const exact = new Date(endsAt * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return (
    <div title={`Closes ${exact}`}>
      <dt className="kicker">Closes in</dt>
      <dd className={`mt-1 text-lg font-black tabular-nums ${soon ? "text-[#a9282f]" : ""}`}>{left === 0 ? "now" : countdown(left)}</dd>
      <dd
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#111318]/12"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(done)}
        aria-label="How much of the epoch has passed"
      >
        <span className={`block h-full ${soon ? "bg-[#a9282f]" : "bg-[#111318]"}`} style={{ width: `${done}%` }} />
      </dd>
    </div>
  );
}

function MyCard({ s, symbol }: { s: StandingsView; symbol: string }) {
  const me = s.me;
  if (!me) return null;
  const activity = me.activity;
  const days = me.rank !== null ? me.days : (activity?.days ?? 0);
  const streak = me.rank !== null ? me.streak : (activity?.streak ?? 0);
  const carried = activity?.carried ?? 0;

  let hint: string;
  if (me.rank === null) hint = `Hold a ${symbol} NFT to join the race. Posting still builds your streak.`;
  else if (BigInt(me.gap) > 0n) hint = `${plural(BigInt(me.gap), "more NFT")} would put you in the top ${REWARDS.maxHolders}.`;
  else if (streak === 0 && carried > 0) hint = `${plural(REWARDS.streakMinDays - days, "more active day")} keeps your ${carried}-week streak.`;
  else if (days < 7) hint = `Post today to make it ${days + 1} of 7 days.`;
  else hint = "Every day this epoch counted. Keep it up.";

  return (
    <div className="mt-4 rounded-xl border-2 border-[#111318] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-black">{me.rank === null ? "You’re not in the race yet" : `You’re #${me.rank}`}</p>
        {me.rank !== null && (
          <p className="text-lg font-black tabular-nums">
            {me.estimate ? `≈ ${formatMon(wei(me.estimate))}` : wei(s.holderPool) === 0n ? "No fees yet" : me.rank > REWARDS.maxHolders ? "Outside the paid places" : "—"}
          </p>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {me.rank !== null && <Stat label="NFTs" value={me.shares} />}
        <div>
          <dt className="kicker">Active days</dt>
          <dd className="mt-1 flex gap-1" aria-label={`${days} of 7 days`}>
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className={`size-2.5 rounded-full border border-[#111318] ${i < days ? "bg-[#111318]" : ""}`} />
            ))}
          </dd>
        </div>
        {me.rank !== null && <Stat label="X posts counted" value={String(me.xShares)} />}
        {me.rank !== null && <Stat label="Bonus" value={`+${percent(me.bonusBps)}`} />}
        {(streak > 0 || carried > 0) && (
          <div>
            <dt className="kicker">Streak</dt>
            <dd className="mt-1 flex items-center gap-1 font-black">
              <FlameIcon className="size-3.5" />
              {plural(Math.max(streak, carried), "week")}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-sm">{hint}</p>
    </div>
  );
}

function Row({ r, mine }: { r: StandingRow; mine: boolean }) {
  return (
    <li className={`flex items-center gap-3 py-2 ${mine ? "font-black" : ""}`}>
      <span className="w-6 text-right text-xs tabular-nums text-muted">{r.rank}</span>
      <WalletAvatar seed={r.wallet} />
      <span className="min-w-0 flex-1">
        <Who address={r.wallet as `0x${string}`} />
      </span>
      <span className="text-xs tabular-nums text-muted">{plural(BigInt(r.shares), "NFT")}</span>
      {r.streak >= 2 && (
        <span className="chip chip-peach">
          <FlameIcon />
          {r.streak}
        </span>
      )}
      {r.bonusBps > 0 && <span className="chip chip-peach">+{percent(r.bonusBps)}</span>}
      <span className="w-24 text-right tabular-nums">{r.estimate ? formatMon(wei(r.estimate)) : "—"}</span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="mt-1 font-black tabular-nums">{value}</dd>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="mt-1 text-lg font-black tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}
