"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";
import { ChallengeSummary, JudgingIcon, PLACES } from "@/components/ChallengeCard";
import { LoadError } from "@/components/ErrorPanel";
import { CoinIcon, PinIcon, TrophyIcon } from "@/components/Icons";
import { Spinner } from "@/components/Spinner";
import { TrustChip } from "@/components/TrustChip";
import { useChallengeActions, useChallenges } from "@/hooks/useChallenges";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { trustOf } from "@/lib/assetTrust";
import {
  CHALLENGE_RULES,
  JUDGING,
  checkChallenge,
  checkRewards,
  isFlat,
  isLive,
  prizeOverdue,
  type ChallengeInput,
  type Judging,
  type PublicChallenge,
  type RewardsInput,
} from "@/lib/challenges";
import { REWARDS_EPOCH_SECONDS, REWARDS_GENESIS } from "@/lib/config";
import { registry } from "@/lib/verifiedAssets";
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
          A challenge is a task the Owner sets the Club. Members answer it with a post; the winners, ranked or drawn, earn the prize the Owner set.
        </p>
        {owner && !archived && (
          <button type="button" className="btn-primary btn-sm" aria-expanded={starting} onClick={() => setStarting(!starting)}>
            {starting ? "Close" : "Start a challenge"}
          </button>
        )}
      </div>
      {starting && owner && (
        <StartForm token={token} now={now} owesPrize={challenges.some((c) => prizeOverdue(c, now * 1000))} onDone={() => setStarting(false)} />
      )}

      {isLoading ? (
        <Loading label="Loading the challenges" />
      ) : challenges.length === 0 ? (
        <Empty title="No challenges yet">
          {owner
            ? "Start one: a meme contest, a best pitch, anything the Club can answer with a post."
            : `When the Owner of ${symbol} sets the Club a challenge, it shows up here.`}
        </Empty>
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

const MODES: { group: string; modes: Judging[] }[] = [
  { group: "Ranked: 1st, 2nd, 3rd", modes: ["likes", "holders", "owner"] },
  { group: "Same prize for every winner", modes: ["raffle", "first", "everyone"] },
];

/** A number field's value, NaN while it's blank, so `checkChallenge` names what's missing. */
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/**
 * The Owner's form (ADR 0045, ADR 0049), in four steps: the task, how the winners are picked, the
 * prize (places for a ranked challenge, one prize for every winner otherwise) and when it ends. It
 * builds what it sends and checks it with the server's own `checkChallenge`, so only a challenge the
 * server takes can be started, and shows the card members will see as it's filled in.
 */
function StartForm({ token, now, owesPrize, onDone }: { token: string; now: number; owesPrize: boolean; onDone: () => void }) {
  const { create } = useChallengeActions(token);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [holdersOnly, setHoldersOnly] = useState(false);
  const [judging, setJudging] = useState<Judging>("likes");
  const [places, setPlaces] = useState<string[]>(["10", "", ""]);
  const [winners, setWinners] = useState("5");
  const [prize, setPrize] = useState("3");
  const [minLikes, setMinLikes] = useState("0");
  // Rewards beside the points (ADR 0050): an NFT or token the Owner sends, and pinning the results.
  const [giveAsset, setGiveAsset] = useState(false);
  const [assetToken, setAssetToken] = useState("");
  const [assetAmounts, setAssetAmounts] = useState<string[]>(["1", "", ""]);
  const [pinWinner, setPinWinner] = useState(false);
  const chosen = giveAsset ? registry.entry(assetToken) : null;
  // An ERC-20's decimals come from its contract, never assumed; the server reads them again itself.
  const tokens = useMemo(() => (chosen?.kind === "erc20" ? [chosen.address as Address] : []), [chosen]);
  const { info } = useTokenInfo(tokens);
  const rewardsCtx = { decimals: (t: string) => info.get(t.toLowerCase())?.decimals };
  // It ends when an epoch does: this one, or one of the next few.
  const current = Math.max(0, epochAt(now, REWARDS_GENESIS, REWARDS_EPOCH_SECONDS));
  const endOf = (k: number) => epochWindow(current + k - 1, REWARDS_GENESIS, REWARDS_EPOCH_SECONDS).end;
  const tooSoon = (k: number) => endOf(k) - now < CHALLENGE_RULES.minHours * 3600;
  const [epochs, setEpochs] = useState(() => (tooSoon(1) ? 2 : 1));
  const flat = isFlat(judging);

  // Blank places after the last one aren't paid; a blank one before it is a gap, which the check refuses.
  const lastPlace = places.reduce((last, p, i) => (p.trim() !== "" ? i : last), -1);
  const paidPlaces = flat ? 1 : Math.max(1, lastPlace + 1);
  const rewards: RewardsInput | undefined =
    giveAsset || pinWinner
      ? {
          ...(giveAsset
            ? { asset: { token: assetToken, amounts: assetAmounts.slice(0, paidPlaces).map((a, i) => (i > 0 && a.trim() === "" ? "0" : a)) } }
            : {}),
          ...(pinWinner ? { pinWinner: true } : {}),
        }
      : undefined;
  const input: ChallengeInput = flat
    ? {
        title,
        brief,
        judging,
        winners: num(winners),
        prize: num(prize),
        ...(judging === "everyone" ? { minLikes: num(minLikes) } : {}),
        epochs,
        holdersOnly,
        ...(rewards ? { rewards } : {}),
      }
    : { title, brief, judging, prizes: places.slice(0, lastPlace + 1).map(num), epochs, holdersOnly, ...(rewards ? { rewards } : {}) };
  const checked = checkChallenge(input, rewardsCtx);
  const rewardsChecked = checkRewards(rewards, paidPlaces, flat, rewardsCtx);
  const problem = !checked.ok
    ? checked.message
    : tooSoon(epochs)
      ? "Less than an hour is left in this epoch: let it run to the end of the next one."
      : giveAsset && owesPrize
        ? "A winner of an earlier challenge here is still waiting on their prize. Send it and mark it sent first."
        : null;

  // What members will see: the card as it would be, with what's been typed so far.
  const n = clamp(num(winners), 1, CHALLENGE_RULES.maxWinners, 1);
  const each = clamp(num(prize), 0, CHALLENGE_RULES.maxFlatPoints, 0);
  const preview: PublicChallenge = {
    id: "preview",
    title: title.trim() || "Your challenge’s title",
    brief: brief.trim() || "What members should do shows here.",
    judging,
    prizes: checked.ok ? checked.challenge.prizes : flat ? Array.from({ length: n }, () => each) : [10],
    holdersOnly,
    startsAt: now * 1000,
    endsAt: endOf(epochs) * 1000,
    by: "",
    phase: "open",
    entries: [],
    entryCount: 0,
    ...(flat ? { winners: n, prize: each } : {}),
    ...(judging === "everyone" ? { minLikes: clamp(num(minLikes), 0, CHALLENGE_RULES.maxMinLikes, 0) } : {}),
    ...(rewardsChecked.ok && rewardsChecked.rewards ? { rewards: rewardsChecked.rewards } : {}),
  };

  return (
    <form
      className="club-panel flex flex-col gap-6 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!problem) create.mutate(input, { onSuccess: onDone });
      }}
    >
      <FormStep n={1} title="The task">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">Title</span>
          <input
            className={field}
            value={title}
            maxLength={CHALLENGE_RULES.titleMax * 2}
            placeholder="Best Chog meme of the week"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">What members should do</span>
          <textarea
            className={`${field} min-h-20 resize-y`}
            value={brief}
            maxLength={CHALLENGE_RULES.briefMax * 2}
            placeholder="Post your funniest Chog on X. Original work only."
            onChange={(e) => setBrief(e.target.value)}
          />
          <span className="text-xs text-muted">Members answer with a post on X, shared to the Board. At most {CHALLENGE_RULES.briefMax} characters.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={holdersOnly} onChange={(e) => setHoldersOnly(e.target.checked)} />
          <span>
            <b>Only Holders can enter</b>
            <span className="block text-xs text-muted">Members who hold the Club’s asset (the Holder badge). Anyone can still like.</span>
          </span>
        </label>
      </FormStep>

      <FormStep n={2} title="How winners are picked">
        {MODES.map(({ group, modes }) => (
          <fieldset key={group} className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{group}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {modes.map((mode) => (
                <label key={mode} className="challenge-mode">
                  <input type="radio" name="judging" className="sr-only" checked={judging === mode} onChange={() => setJudging(mode)} />
                  <span className="flex items-center gap-1.5 text-sm font-black">
                    <JudgingIcon judging={mode} className="size-4 shrink-0" />
                    {JUDGING[mode].label}
                  </span>
                  <span className="text-xs leading-snug text-muted">
                    {mode === "owner"
                      ? `After it ends you have ${CHALLENGE_RULES.pickWindowMs / 86_400_000} days to pick the winners, best first.`
                      : JUDGING[mode].line}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </FormStep>

      <FormStep n={3} title="The prize">
        {flat ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField label="Number of winners" hint={`1 to ${CHALLENGE_RULES.maxWinners}`} value={winners} onChange={setWinners} />
            <NumberField label="Points each" hint={`0 to ${CHALLENGE_RULES.maxFlatPoints} · 0 is a trophy only`} value={prize} onChange={setPrize} />
            {judging === "everyone" && (
              <NumberField label="Likes an entry needs" hint={`0 to ${CHALLENGE_RULES.maxMinLikes} · 0 is any entry`} value={minLikes} onChange={setMinLikes} />
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {PLACES.map((place, i) => (
              <NumberField
                key={place}
                label={`${place} place${i > 0 ? " (optional)" : ""}`}
                hint={i === 0 ? `0 to ${CHALLENGE_RULES.maxPoints} points` : "No more than above"}
                value={places[i]!}
                onChange={(v) => setPlaces(places.map((p, j) => (j === i ? v : p)))}
              />
            ))}
          </div>
        )}
        <p className="text-xs text-muted">
          {judging === "raffle"
            ? "The draw uses a Monad block that doesn’t exist yet when it ends, so anyone can check it."
            : judging === "first"
              ? "Entries stay open to the end. If an early one drops out, the next in line moves up."
              : judging === "everyone"
                ? "If more entries make it than there are winners, the earliest win."
                : "Points count like any other activity points."}
        </p>
      </FormStep>

      <FormStep n={4} title="Rewards">
        <div className="flex items-start gap-2.5 rounded-xl border-2 border-[#111318]/15 bg-white px-3 py-2.5 text-sm">
          <TrophyIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            <b>Every winner gets a trophy</b>
            <span className="block text-xs text-muted">It shows on their profile and beside their name in Members.</span>
          </span>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={giveAsset} onChange={(e) => setGiveAsset(e.target.checked)} />
          <span>
            <b>Also give an NFT or token</b>
            <span className="block text-xs text-muted">From your own wallet, after it ends. Only assets on DeClub’s verified list.</span>
          </span>
        </label>
        {giveAsset && (
          <div className="flex flex-col gap-3 rounded-xl border-2 border-[#111318]/15 bg-white p-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold">The asset</span>
              <span className="flex flex-wrap items-center gap-2">
                <select className={`${field} min-w-0 flex-1`} value={assetToken} onChange={(e) => setAssetToken(e.target.value)}>
                  <option value="">Choose a verified NFT or token…</option>
                  {registry.verified().map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.name} ({a.symbol}) · {a.kind === "erc721" ? "NFT" : "token"}
                    </option>
                  ))}
                </select>
                {chosen && <TrustChip trust={trustOf(chosen.address, chosen)} />}
              </span>
              {chosen && <span className="break-all font-mono text-[0.7rem] text-muted">{chosen.address}</span>}
            </label>
            {chosen && (
              <div className={`grid gap-3 ${flat ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3"}`}>
                {Array.from({ length: paidPlaces }, (_, i) => (
                  <AmountField
                    key={i}
                    label={flat ? "Each winner gets" : `${PLACES[i]} place`}
                    hint={`${chosen.kind === "erc721" ? "NFTs" : chosen.symbol}${i > 0 ? " · blank: none" : ""}`}
                    decimals={chosen.kind === "erc20"}
                    value={assetAmounts[i] ?? ""}
                    onChange={(v) => setAssetAmounts(assetAmounts.map((a, j) => (j === i ? v : a)))}
                  />
                ))}
              </div>
            )}
            <ol className="grid gap-2 text-xs sm:grid-cols-3">
              {[
                "The winners are picked.",
                "You send each one their prize from your wallet.",
                "You paste the transaction here; the app checks it on chain.",
              ].map((step, i) => (
                <li key={step} className="flex items-start gap-2 rounded-lg bg-[#111318]/5 px-2.5 py-2">
                  <span className="challenge-place challenge-place-sm" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="font-semibold">{step}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted">DeClub never holds the prize and can’t send it for you. Members see whether you did.</p>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={pinWinner} onChange={(e) => setPinWinner(e.target.checked)} />
          <span>
            <b className="inline-flex items-center gap-1">
              <PinIcon className="size-3.5" /> Pin the winners on the Board for {CHALLENGE_RULES.pinResultsMs / 86_400_000} days
            </b>
            <span className="block text-xs text-muted">The results card stays on top, with the winning entry.</span>
          </span>
        </label>
      </FormStep>

      <FormStep n={5} title="Ends with">
        <select className={field} value={epochs} aria-label="Ends with" onChange={(e) => setEpochs(Number(e.target.value))}>
          {Array.from({ length: CHALLENGE_RULES.maxEpochs }, (_, i) => i + 1).map((k) => (
            <option key={k} value={k} disabled={tooSoon(k)}>
              {k === 1 ? "This epoch" : k === 2 ? "The next epoch" : `Epoch ${current + k - 1}`} · in {countdown(endOf(k) - now)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">A challenge ends when an epoch does, and the winners’ points count in that epoch.</span>
      </FormStep>

      <section className="flex flex-col gap-2" aria-label="Preview">
        <h3 className="kicker">What members will see</h3>
        <div inert className="pointer-events-none select-none">
          <ChallengeSummary c={preview} token={token} now={now} heading="New challenge" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" aria-busy={create.isPending} disabled={!!problem || create.isPending}>
          {create.isPending && <Spinner />}
          {create.isPending ? "Starting…" : "Start the challenge"}
        </button>
        <span className={`text-xs ${problem ? "font-bold" : "text-muted"}`} role="status">
          {problem ?? "It starts now and is logged. You can’t enter your own challenge."}
        </span>
      </div>
    </form>
  );
}

/** One numbered step of the form. */
function FormStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-base font-black">
        <span className="challenge-place" aria-hidden>
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** An amount of the asset prize: whole NFTs, or token units with a decimal point. */
function AmountField({
  label,
  hint,
  decimals,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  decimals: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 text-xs font-bold">
        <CoinIcon className="size-3.5" />
        {label}
      </span>
      <input
        className={`${field} tabular-nums`}
        inputMode={decimals ? "decimal" : "numeric"}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, ""))}
      />
      <span className="text-[0.7rem] text-muted">{hint}</span>
    </label>
  );
}

function NumberField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold">{label}</span>
      <input className={`${field} tabular-nums`} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))} />
      <span className="text-[0.7rem] text-muted">{hint}</span>
    </label>
  );
}
