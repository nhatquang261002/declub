"use client";

import { useState } from "react";
import { Alert } from "@/components/Alert";
import { LinkIcon } from "@/components/Icons";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubActions, useClubPage, useClubStaff } from "@/hooks/useClubBoard";
import type { ViewerRole } from "@/hooks/useClubMembership";
import { MAX_DESCRIPTION, MAX_LINKS } from "@/lib/clubPosts";
import { isOwnerOrAdmin } from "@/lib/clubRoles";
import { ago } from "@/lib/format";
import { Panel } from "./parts";
import { CopyAddress } from "@/components/CopyAddress";

/** What a log line says, in words. */
const ACTIONS: Record<string, string> = {
  hide_post: "hid a post",
  restore_post: "restored a post",
  delete_post: "deleted a post",
  auto_hide: "post hidden after reports",
  pin_post: "pinned a post",
  unpin_post: "unpinned a post",
  ban: "banned",
  unban: "lifted the ban on",
  ban_everywhere: "banned everywhere",
  unban_everywhere: "lifted the ban everywhere on",
  appoint_moderator: "appointed a moderator:",
  remove_moderator: "removed a moderator:",
  assign_owner: "made Owner:",
  remove_owner: "removed the Owner:",
  claim_owner: "claimed ownership through owner():",
  edit_profile: "edited the Club page",
};

const field = "input border-2 border-[#111318]/25 bg-white focus:border-[#111318]";

function PageEditor({ token }: { token: string }) {
  const page = useClubPage(token);
  const { profile } = useClubActions(token);
  const [draft, setDraft] = useState<{ description: string; links: string[]; holdersOnlyPosts: boolean } | null>(null);
  const current = draft ?? { description: page?.description ?? "", links: page?.links ?? [], holdersOnlyPosts: page?.holdersOnlyPosts ?? false };
  const links = [...current.links, ...Array(MAX_LINKS).fill("")].slice(0, MAX_LINKS) as string[];
  const length = [...current.description].length;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        profile.mutate({ ...current, links: links.map((l) => l.trim()).filter(Boolean) }, { onSuccess: () => setDraft(null) });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-sm font-bold">
          About the Club
          <span className={`text-xs font-normal tabular-nums ${length > MAX_DESCRIPTION ? "text-danger" : "text-muted"}`}>
            {length}/{MAX_DESCRIPTION}
          </span>
        </span>
        <textarea
          className={`${field} min-h-28 resize-y`}
          value={current.description}
          placeholder="What this collection is, who's behind it, where the community hangs out."
          onChange={(e) => setDraft({ ...current, description: e.target.value })}
        />
        <span className="text-xs text-muted">Shown under the Club’s name, as plain text.</span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-bold">Links</legend>
        {links.map((link, i) => (
          <label key={i} className="relative">
            <span className="sr-only">Link {i + 1}</span>
            <LinkIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              className={`${field} pl-9`}
              value={link}
              placeholder="https://"
              onChange={(e) => setDraft({ ...current, links: links.map((l, j) => (j === i ? e.target.value : l)) })}
            />
          </label>
        ))}
        <span className="text-xs text-muted">Up to {MAX_LINKS}, https only: a website, X, Discord.</span>
      </fieldset>
      <label className="flex items-start gap-3 rounded-xl border-2 border-[#111318]/15 bg-white/60 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[#d83b45]"
          checked={current.holdersOnlyPosts}
          onChange={(e) => setDraft({ ...current, holdersOnlyPosts: e.target.checked })}
        />
        <span>
          <span className="font-bold">Only holders can post</span>
          <span className="block text-xs text-muted">Members who don’t hold the asset can still read and report. Moderators can always post.</span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={profile.isPending || draft === null}>
          {profile.isPending ? "Saving…" : "Save changes"}
        </button>
        {draft !== null && !profile.isPending && (
          <button type="button" className="text-sm font-bold text-muted hover:text-[#111318]" onClick={() => setDraft(null)}>
            Discard
          </button>
        )}
      </div>
    </form>
  );
}

/** The staff view: the Club's page text, bans, the moderation log, and claiming ownership. */
export function ClubManage({ token, role, now }: { token: string; role: ViewerRole; now: number }) {
  const { log, ownership, bans, isLoading } = useClubStaff(token, true);
  const { unban } = useClubActions(token);
  const owner = isOwnerOrAdmin(role);
  const banned = bans ? [...bans.club.map((b) => ({ ...b, everywhere: false })), ...bans.everywhere.map((b) => ({ ...b, everywhere: true }))] : [];

  return (
    <div className="flex flex-col gap-5">
      {ownership?.changed && (
        <Alert tone="warn" title="Ownership changed on-chain">
          The Owner claimed this Club as <CopyAddress address={ownership.claimed} />, but the contract’s owner() is now{" "}
          {ownership.onchain ? <CopyAddress address={ownership.onchain} /> : <span className="font-mono">unreadable or removed</span>}. Review who should hold the Club.
        </Alert>
      )}

      {owner && (
        <Panel title="Club page">
          <PageEditor token={token} />
        </Panel>
      )}

      <Panel title={`Bans${banned.length ? ` · ${banned.length}` : ""}`}>
        {banned.length === 0 ? (
          <p className="text-sm text-muted">Nobody is banned.</p>
        ) : (
          <ul className="-mx-5 divide-y divide-[#111318]/10 border-y border-[#111318]/10">
            {banned.map((b) => (
              <li key={`${b.everywhere}-${b.wallet}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <WalletAvatar seed={b.wallet} size="1.75rem" />
                <span className="min-w-0 flex-1">
                  <Who address={b.wallet} />
                </span>
                {b.everywhere && <span className="chip chip-danger">Everywhere</span>}
                <span className="text-xs text-muted">{ago(Math.floor(b.at / 1000), now)}</span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => unban.mutate({ wallet: b.wallet, everywhere: b.everywhere })}>
                  Lift ban
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Moderation log">
        <p className="-mt-1 mb-3 text-xs text-muted">Every role change and moderation action, newest first. Only staff can see it.</p>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : log.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ol className="relative flex flex-col gap-3 border-l-2 border-[#111318]/15 pl-4 text-sm">
            {log.map((entry) => (
              <li key={entry.id} className="relative">
                <span className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full border-2 border-[#111318] bg-[#f0b735]" aria-hidden />
                <p className="flex flex-wrap items-baseline gap-x-1.5">
                  <CopyAddress address={entry.actor} className="text-xs font-bold" />
                  <span>{ACTIONS[entry.action] ?? entry.action}</span>
                  {entry.target && (entry.target.length > 20 ? <CopyAddress address={entry.target} className="text-xs" /> : <span className="font-mono text-xs break-all">{entry.target}</span>)}
                  {entry.detail && <span className="text-xs text-muted">({entry.detail})</span>}
                </p>
                <p className="text-xs text-muted">{ago(Math.floor(entry.at / 1000), now)}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
