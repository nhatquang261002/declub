"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { Alert } from "@/components/Alert";
import { Spinner } from "@/components/Spinner";
import { ExternalIcon, LinkIcon, XLogoIcon } from "@/components/Icons";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubActions, useClubPage, useClubStaff, type ClubCoin } from "@/hooks/useClubBoard";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import type { ViewerRole } from "@/hooks/useClubMembership";
import { MAX_DESCRIPTION, MAX_LINKS } from "@/lib/clubPosts";
import { MAX_X_ACCOUNTS, MAX_X_TAGS, normalizeTag } from "@/lib/xPosts";
import { isOwnerOrAdmin } from "@/lib/clubRoles";
import { ago } from "@/lib/format";
import { Panel } from "./parts";
import { RewardSettings } from "./RewardSettings";
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
  link_x: "linked the X account",
  unlink_x: "unlinked the X account",
  edit_rules: "changed the reward rules",
  reward_ban: "banned from rewards:",
  reward_unban: "lifted the rewards ban on",
  create_challenge: "started a challenge:",
  cancel_challenge: "cancelled a challenge:",
  settle_challenge: "settled a challenge:",
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
          <span className="font-bold">Only Holders can post</span>
          <span className="block text-xs text-muted">Members who don’t hold the asset can still read and report. Moderators can always post.</span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" aria-busy={profile.isPending} disabled={profile.isPending || draft === null}>
          {profile.isPending && <Spinner />}
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

/** "1.5" → base units at `decimals`, or null when it isn't an amount above zero with at most that many decimals. */
function toUnits(input: string, decimals: number): bigint | null {
  const value = input.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(value) || (value.split(".")[1]?.length ?? 0) > decimals) return null;
  const units = parseUnits(value, decimals);
  return units > 0n ? units : null;
}

/**
 * Whether holding the Club's memecoin earns the Holder badge, and from how much (ADR 0026). NFTs
 * always do. Club Rewards follow the NFTs either way.
 */
function CoinEditor({ token, coin }: { token: string; coin: ClubCoin }) {
  const { profile } = useClubActions(token);
  const { info } = useTokenInfo([coin.token as Address]);
  const decimals = info.get(coin.token)?.decimals;
  const [draft, setDraft] = useState<{ on: boolean; amount: string } | null>(null);
  const current = draft ?? { on: coin.on, amount: decimals === undefined ? "" : formatUnits(BigInt(coin.min), decimals) };
  const units = decimals === undefined ? null : toUnits(current.amount, decimals);
  const bad = current.on && current.amount.trim() !== "" && units === null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        profile.mutate({ coinHolders: { on: current.on, ...(units ? { min: units.toString() } : {}) } }, { onSuccess: () => setDraft(null) });
      }}
    >
      <label className="flex items-start gap-3 rounded-xl border-2 border-[#111318]/15 bg-white/60 p-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[#d83b45]" checked={current.on} onChange={(e) => setDraft({ ...current, on: e.target.checked })} />
        <span>
          <span className="font-bold">Holding {coin.symbol} makes a member a Holder</span>
          <span className="block text-xs text-muted">
            Off: only the collection’s NFTs earn the badge. Either way, Club Rewards are shared by NFTs only.
          </span>
        </span>
      </label>
      {current.on && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">Minimum {coin.symbol}</span>
          <input
            className={field}
            value={current.amount}
            inputMode="decimal"
            placeholder={decimals === undefined ? "Reading the token…" : "1000"}
            disabled={decimals === undefined}
            onChange={(e) => setDraft({ ...current, amount: e.target.value })}
          />
          <span className={`text-xs ${bad ? "text-danger" : "text-muted"}`}>
            {bad
              ? `Enter an amount above zero, with up to ${decimals} decimals.`
              : `Summed over a member’s linked wallets.${coin.set ? "" : " Until you save, the verified list’s minimum applies."}`}
          </span>
        </label>
      )}
      <span className="text-xs text-muted">Badges catch up as the Members list is read; nobody’s is more than a day out of date.</span>
      <button type="submit" className="btn-secondary btn-sm w-fit" disabled={profile.isPending || draft === null || bad}>
        {profile.isPending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

/**
 * The Club on X (ADR 0024): the project's accounts, linked by a post only they could make, and the
 * tags that make an X post about the Club. Members' own X posts that match count for the Club.
 */
function XEditor({ token }: { token: string }) {
  const page = useClubPage(token);
  const { xStart, xVerify, xUnlink, profile } = useClubActions(token);
  const [handle, setHandle] = useState("");
  const [proof, setProof] = useState<{ handle: string; text: string } | null>(null);
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState<string | null>(null);
  const accounts = page?.x?.accounts ?? [];
  const currentTags = tags ?? (page?.x?.tags ?? []).join(" ");
  const parsed = currentTags.split(/[\s,]+/).filter(Boolean);
  const badTag = parsed.find((t) => !normalizeTag(t));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold">Project X accounts</p>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted">None linked. Link the project’s own account so posts that mention or quote it count in full.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {accounts.map((a) => (
              <li key={a.handle} className="flex flex-wrap items-center gap-2 text-sm">
                <a className="inline-flex items-center gap-1.5 font-bold hover:underline" href={`https://x.com/${a.handle}`} target="_blank" rel="noopener noreferrer">
                  <XLogoIcon className="size-3.5" />@{a.handle} ✓
                </a>
                <a className="text-xs text-muted hover:underline" href={`https://x.com/i/status/${a.proof}`} target="_blank" rel="noopener noreferrer">
                  proof
                </a>
                <button type="button" className="ml-auto text-xs font-bold text-muted hover:text-danger" disabled={xUnlink.isPending} onClick={() => xUnlink.mutate(a.handle)}>
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        )}

        {accounts.length < MAX_X_ACCOUNTS && !proof && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              xStart.mutate(handle, { onSuccess: (r) => (setProof({ handle: r.handle, text: r.text }), setUrl("")) });
            }}
          >
            <label className="relative min-w-48 flex-1">
              <span className="sr-only">The project’s X handle</span>
              <XLogoIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
              <input className={`${field} pl-9`} value={handle} placeholder="@ProjectHandle" onChange={(e) => setHandle(e.target.value)} />
            </label>
            <button type="submit" className="btn-secondary btn-sm" disabled={xStart.isPending || handle.trim().length === 0}>
              {xStart.isPending ? "…" : "Link account"}
            </button>
          </form>
        )}

        {proof && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-[#111318]/15 bg-white/60 p-3 text-sm">
            <p>
              Post this from <span className="font-bold">@{proof.handle}</span>, then paste the post’s link. The code is good for 24 hours; you can delete
              the post once it’s linked.
            </p>
            <p className="rounded-lg bg-white p-2 font-mono text-xs break-all">{proof.text}</p>
            <a
              className="btn-secondary btn-sm w-fit"
              href={`https://x.com/intent/post?text=${encodeURIComponent(proof.text)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Post it on X <ExternalIcon className="size-3" />
            </a>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                xVerify.mutate({ handle: proof.handle, url }, { onSuccess: () => (setProof(null), setHandle("")) });
              }}
            >
              <input className={`${field} min-w-48 flex-1`} value={url} inputMode="url" placeholder="https://x.com/…/status/…" onChange={(e) => setUrl(e.target.value)} />
              <button type="submit" className="btn-primary btn-sm" aria-busy={xVerify.isPending} disabled={xVerify.isPending || url.trim().length === 0}>
                {xVerify.isPending && <Spinner />}
                {xVerify.isPending ? "Checking…" : "Check and link"}
              </button>
              <button type="button" className="text-xs font-bold text-muted hover:text-[#111318]" onClick={() => setProof(null)}>
                Cancel
              </button>
            </form>
          </div>
        )}
      </div>

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          profile.mutate({ xTags: parsed }, { onSuccess: () => setTags(null) });
        }}
      >
        <label className="text-sm font-bold" htmlFor="club-x-tags">
          Tags
        </label>
        <input id="club-x-tags" className={field} value={currentTags} placeholder="#chog $CHOG chogs" onChange={(e) => setTags(e.target.value)} />
        <span className={`text-xs ${badTag || parsed.length > MAX_X_TAGS ? "text-danger" : "text-muted"}`}>
          {badTag
            ? `“${badTag}” isn’t a tag: use a #hashtag, a $cashtag or a word of 2 to 30 letters, digits or _.`
            : `Up to ${MAX_X_TAGS}, separated by spaces. A post that only matches a tag counts half. The Club’s ticker is always one.`}
        </span>
        {page?.x?.hint && <span className="text-xs text-muted">Right now a member’s own X post counts when it {page.x.hint}.</span>}
        <button type="submit" className="btn-secondary btn-sm mt-1 w-fit" disabled={profile.isPending || tags === null || !!badTag || parsed.length > MAX_X_TAGS}>
          Save tags
        </button>
      </form>
    </div>
  );
}

/** The staff view: the Club's page text, bans, the moderation log, and claiming ownership. */
export function ClubManage({ token, role, now }: { token: string; role: ViewerRole; now: number }) {
  const { log, ownership, bans, reported, isLoading } = useClubStaff(token, true);
  const { unban, hide, remove } = useClubActions(token);
  const page = useClubPage(token);
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

      <Panel title="Rewards">
        <RewardSettings token={token} owner={owner} now={now} />
      </Panel>

      {owner && (
        <Panel title="Club page">
          <PageEditor token={token} />
        </Panel>
      )}

      {owner && page?.coin && (
        <Panel title={`${page.coin.symbol} holders`}>
          <CoinEditor token={token} coin={page.coin} />
        </Panel>
      )}

      {owner && (
        <Panel title="The Club on X">
          <XEditor token={token} />
        </Panel>
      )}

      <Panel title={`Reported${reported.length ? ` · ${reported.length}` : ""}`}>
        <p className="-mt-1 mb-3 text-xs text-muted">
          Reports never hide a post by themselves: a hidden post’s backing counts for nothing, so only a moderator decides. Holders’ reports are counted apart.
        </p>
        {reported.length === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting for review.</p>
        ) : (
          <ul className="-mx-5 divide-y divide-[#111318]/10 border-y border-[#111318]/10">
            {reported.map(({ post, reports, holderReports }) => (
              <li key={post.id} className="flex flex-col gap-2 px-5 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <WalletAvatar seed={post.wallet} size="1.5rem" />
                  <Who address={post.wallet} />
                  {post.parent && <span className="chip">Reply</span>}
                  {post.hidden && <span className="chip chip-warn">Hidden</span>}
                  <span className="text-xs text-muted">
                    {reports} {reports === 1 ? "report" : "reports"}
                    {holderReports > 0 && ` · ${holderReports} from Holders or staff`} · {ago(Math.floor(post.at / 1000), now)}
                  </span>
                </p>
                {post.text !== null && <p className="break-words whitespace-pre-wrap">{post.text}</p>}
                <div className="flex flex-wrap gap-2">
                  {!post.hidden && (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => hide.mutate({ id: post.id, hidden: true })}>
                      Hide
                    </button>
                  )}
                  <button type="button" className="btn-secondary btn-sm" onClick={() => hide.mutate({ id: post.id, hidden: false })}>
                    {post.hidden ? "Restore" : "Dismiss reports"}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => remove.mutate(post.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

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
