"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubActions, useClubRules, useRewardBans } from "@/hooks/useClubBoard";
import { ago } from "@/lib/format";
import { DEFAULT_CLUB_RULES, OWNER_RULES, WHOLE_RULES, whoIsPaid, type OwnerRule, type OwnerRules } from "@/lib/rewards";

const field = "input border-2 border-[#111318]/25 bg-white focus:border-[#111318]";

/** How each Owner rule is asked for. `percent` rules are stored in basis points and shown as percentages. */
const FIELDS: Record<OwnerRule, { label: string; hint: string; percent?: true }> = {
  maxPaid: { label: "Pay at most this many Holders", hint: "The most active first. 0 is no limit." },
  maxPaidPercent: { label: "Pay at most this % of Holders", hint: "The most active first, rounded up. 100 is no limit." },
  rampPoints: { label: "Points for a whole share", hint: "Below this a Holder is paid part of their share: half at half the points." },
  nonHolderBps: { label: "Slice for members without NFTs (%)", hint: "Split by their points. 0 is off. The rest stays with the Holders.", percent: true },
};

const shown = (key: OwnerRule, value: number) => String(FIELDS[key].percent ? value / 100 : value);
const stored = (key: OwnerRule, text: string) => (FIELDS[key].percent ? Math.round(Number(text) * 100) : Number(text));

/**
 * The Owner's reward settings (ADR 0044): who is paid and how much of their share, from the next
 * epoch, and the members banned from rewards. How points are counted is the same in every Club and
 * isn't here. Moderators see the settings and the bans; only the Owner changes them.
 */
export function RewardSettings({ token, owner, now }: { token: string; owner: boolean; now: number }) {
  const view = useClubRules(token);
  const { rules: save } = useClubActions(token);
  const [draft, setDraft] = useState<Partial<Record<OwnerRule, string>>>({});
  if (!view) return <p className="text-sm text-muted">Loading…</p>;

  const base = view.next?.rules ?? view.current;
  const value = (k: OwnerRule) => draft[k] ?? shown(k, base[k]);
  const errors = Object.fromEntries(
    Object.entries(draft).flatMap(([k, text]) => {
      const key = k as OwnerRule;
      const [least, most] = view.bounds[key];
      const n = stored(key, text!);
      if (text!.trim() === "" || !Number.isFinite(n)) return [[key, "Give a number."]];
      if (n < least || n > most) return [[key, `Between ${shown(key, least)} and ${shown(key, most)}.`]];
      if (WHOLE_RULES.has(key) && !Number.isInteger(n)) return [[key, "A whole number."]];
      return [];
    }),
  ) as Partial<Record<OwnerRule, string>>;
  const changes = Object.fromEntries(
    Object.entries(draft)
      .map(([k, text]) => [k, stored(k as OwnerRule, text!)] as const)
      .filter(([k, n]) => n !== base[k as OwnerRule]),
  ) as Partial<OwnerRules>;
  const dirty = Object.keys(changes).length > 0;
  const bad = Object.keys(errors).length > 0;

  // Whether the form, as edited, is back to the defaults: then there's nothing to reset.
  const atDefaults = OWNER_RULES.every((k) => stored(k, value(k)) === DEFAULT_CLUB_RULES[k]);

  const input = (k: OwnerRule) => (
    <label key={k} className="flex flex-col gap-1">
      <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-bold">
        {FIELDS[k].label}
        <span className={`text-xs font-normal ${stored(k, value(k)) === DEFAULT_CLUB_RULES[k] ? "text-muted" : "text-[#a9282f]"}`}>
          Default: {shown(k, DEFAULT_CLUB_RULES[k])}
        </span>
      </span>
      <input
        className={`${field} tabular-nums`}
        inputMode="decimal"
        value={value(k)}
        disabled={!owner}
        aria-invalid={!!errors[k]}
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      />
      <span className={`text-xs ${errors[k] ? "text-danger" : "text-muted"}`}>
        {errors[k] ?? FIELDS[k].hint}
      </span>
    </label>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(changes, { onSuccess: () => setDraft({}) });
      }}
    >
      <p className="text-sm">
        This epoch pays <b>{whoIsPaid(view.current)}</b>, a whole share from {view.current.rampPoints} points
        {view.current.nonHolderBps > 0 ? `, and ${view.current.nonHolderBps / 100}% of the pool to members without NFTs` : ""}.
      </p>
      {view.next && (
        <p className="rounded-lg bg-[#f0b735]/25 px-3 py-2 text-sm">
          From epoch {view.next.from}: {whoIsPaid(view.next.rules)}, a whole share from {view.next.rules.rampPoints} points
          {view.next.rules.nonHolderBps > 0 ? `, ${view.next.rules.nonHolderBps / 100}% to members without NFTs` : ""}. The form shows these.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">{OWNER_RULES.map(input)}</div>
      <p className="text-xs text-muted">How points are counted (backing, active days, swaps, streaks) is the same in every Club.</p>
      {owner ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" aria-busy={save.isPending} disabled={save.isPending || !dirty || bad}>
            {save.isPending && <Spinner />}
            {save.isPending ? "Saving…" : "Save for the next epoch"}
          </button>
          {!atDefaults && !save.isPending && (
            <button
              type="button"
              className="text-sm font-bold text-muted hover:text-[#111318]"
              onClick={() => setDraft(Object.fromEntries(OWNER_RULES.map((k) => [k, shown(k, DEFAULT_CLUB_RULES[k])])))}
            >
              Use the defaults
            </button>
          )}
          {Object.keys(draft).length > 0 && !save.isPending && (
            <button type="button" className="text-sm font-bold text-muted hover:text-[#111318]" onClick={() => setDraft({})}>
              Discard
            </button>
          )}
          <span className="text-xs text-muted">Changes apply from epoch {view.epoch + 1}, are logged, and are published with each epoch.</span>
        </div>
      ) : (
        <p className="text-xs text-muted">Only the Owner can change these.</p>
      )}
      <RewardBans token={token} owner={owner} now={now} />
    </form>
  );
}

/** Members banned from rewards: not paid, and their backing gives nobody points (ADR 0044). */
function RewardBans({ token, owner, now }: { token: string; owner: boolean; now: number }) {
  const bans = useRewardBans(token, true);
  const { rewardBan } = useClubActions(token);
  const [wallet, setWallet] = useState("");
  const valid = /^0x[0-9a-fA-F]{40}$/.test(wallet.trim());

  return (
    <div className="border-t-2 border-[#111318]/10 pt-4">
      <h3 className="text-sm font-bold">Banned from rewards{bans.length ? ` · ${bans.length}` : ""}</h3>
      <p className="mt-1 text-xs text-muted">
        They stay in the Club but aren’t paid, and their likes and replies give nobody points, in this epoch and every one after. Published with each epoch.
      </p>
      {bans.length > 0 && (
        <ul className="-mx-5 mt-3 divide-y divide-[#111318]/10 border-y border-[#111318]/10">
          {bans.map((b) => (
            <li key={b.wallet} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <WalletAvatar seed={b.wallet} size="1.75rem" />
              <span className="min-w-0 flex-1">
                <Who address={b.wallet} />
              </span>
              <span className="text-xs text-muted">{ago(Math.floor(b.at / 1000), now)}</span>
              {owner && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => rewardBan.mutate({ wallet: b.wallet, ban: false })}>
                  Lift
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {owner && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className={`${field} min-w-0 flex-1 font-mono text-sm`} placeholder="The member’s Club wallet, 0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} />
          <button
            type="button"
            className="btn-secondary"
            disabled={!valid || rewardBan.isPending}
            onClick={() => rewardBan.mutate({ wallet: wallet.trim(), ban: true }, { onSuccess: () => setWallet("") })}
          >
            Ban from rewards
          </button>
        </div>
      )}
    </div>
  );
}
