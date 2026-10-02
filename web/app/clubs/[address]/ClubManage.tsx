"use client";

import { useState } from "react";
import { Who } from "@/components/Who";
import { useClubActions, useClubPage, useClubStaff } from "@/hooks/useClubBoard";
import type { ViewerRole } from "@/hooks/useClubMembership";
import { MAX_DESCRIPTION, MAX_LINKS } from "@/lib/clubPosts";
import { isOwnerOrAdmin } from "@/lib/clubRoles";
import { ago, shortAddress } from "@/lib/format";

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

const label = "text-xs font-bold text-muted";

function PageEditor({ token }: { token: string }) {
  const page = useClubPage(token);
  const { profile } = useClubActions(token);
  const [draft, setDraft] = useState<{ description: string; links: string[]; holdersOnlyPosts: boolean } | null>(null);
  const current = draft ?? { description: page?.description ?? "", links: page?.links ?? [], holdersOnlyPosts: page?.holdersOnlyPosts ?? false };
  const links = [...current.links, ...Array(MAX_LINKS).fill("")].slice(0, MAX_LINKS) as string[];

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        profile.mutate({ ...current, links: links.map((l) => l.trim()).filter(Boolean) }, { onSuccess: () => setDraft(null) });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className={label}>
          About the Club ({[...current.description].length}/{MAX_DESCRIPTION})
        </span>
        <textarea
          className="input min-h-24 resize-y"
          value={current.description}
          onChange={(e) => setDraft({ ...current, description: e.target.value })}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>Links (https only, up to {MAX_LINKS})</legend>
        {links.map((link, i) => (
          <input
            key={i}
            className="input"
            value={link}
            placeholder="https://"
            aria-label={`Link ${i + 1}`}
            onChange={(e) => setDraft({ ...current, links: links.map((l, j) => (j === i ? e.target.value : l)) })}
          />
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={current.holdersOnlyPosts}
          onChange={(e) => setDraft({ ...current, holdersOnlyPosts: e.target.checked })}
        />
        Only holders can post (moderators still can)
      </label>
      <div>
        <button type="submit" className="btn-primary" disabled={profile.isPending || draft === null}>
          {profile.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/** The staff view: the Club's page text, bans, the moderation log, and claiming ownership. */
export function ClubManage({ token, role, now }: { token: string; role: ViewerRole; now: number }) {
  const { log, ownership, bans, isLoading } = useClubStaff(token, true);
  const { unban } = useClubActions(token);
  const owner = isOwnerOrAdmin(role);

  return (
    <div className="flex flex-col gap-6">
      {owner && (
        <section className="page-section p-5">
          <h2 className="mb-3 text-lg font-extrabold">Club page</h2>
          <PageEditor token={token} />
        </section>
      )}

      {ownership?.changed && (
        <p className="page-section p-5 text-sm text-warn">
          Ownership changed on-chain: the Owner claimed this Club as <span className="font-mono">{shortAddress(ownership.claimed)}</span>, but the
          contract’s owner() is now{" "}
          <span className="font-mono">{ownership.onchain ? shortAddress(ownership.onchain) : "unreadable or removed"}</span>. Review who should hold the Club.
        </p>
      )}

      <section className="page-section p-5">
        <h2 className="mb-3 text-lg font-extrabold">Bans</h2>
        {!bans || (bans.club.length === 0 && bans.everywhere.length === 0) ? (
          <p className="text-sm text-muted">Nobody is banned.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {[...bans.club.map((b) => ({ ...b, everywhere: false })), ...bans.everywhere.map((b) => ({ ...b, everywhere: true }))].map((b) => (
              <li key={`${b.everywhere}-${b.wallet}`} className="flex flex-wrap items-center gap-3">
                <Who address={b.wallet} plain />
                {b.everywhere && <span className="rounded-full border border-line px-2 py-0.5 text-xs">Everywhere</span>}
                <span className="text-xs text-muted">{ago(Math.floor(b.at / 1000), now)}</span>
                <button type="button" className="text-xs underline" onClick={() => unban.mutate({ wallet: b.wallet, everywhere: b.everywhere })}>
                  Lift ban
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="page-section p-5">
        <h2 className="mb-1 text-lg font-extrabold">Moderation log</h2>
        <p className="mb-3 text-xs text-muted">Every role change and moderation action, newest first. Only staff can see it.</p>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : log.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-muted">{ago(Math.floor(entry.at / 1000), now)}</span>
                <span className="font-mono text-xs">{shortAddress(entry.actor)}</span>
                <span>{ACTIONS[entry.action] ?? entry.action}</span>
                {entry.target && <span className="font-mono text-xs break-all">{entry.target.length > 20 ? shortAddress(entry.target) : entry.target}</span>}
                {entry.detail && <span className="text-xs text-muted">({entry.detail})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
