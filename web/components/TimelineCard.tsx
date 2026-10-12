"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionMenu } from "@/components/ActionMenu";
import { ClubAvatar, ClubCover } from "@/components/ClubArt";
import { BadgeCheckIcon, ChatIcon, FlagIcon, HeartIcon, SearchIcon, SwapIcon } from "@/components/Icons";
import { linkHref, linkLabel, Thread, XPostCard } from "@/components/PostItem";
import { PostText } from "@/components/PostText";
import { Tooltip } from "@/components/Tooltip";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubActions, useClubPage } from "@/hooks/useClubBoard";
import { useClubMembership } from "@/hooks/useClubMembership";
import type { ClubInfo } from "@/lib/clubs";
import { isStaff } from "@/lib/clubRoles";
import { ago } from "@/lib/format";
import type { TimelinePost } from "@/lib/timeline";

/** A short post with nothing attached reads as a line to quote, so it is set large. */
const QUOTE_MAX = 90;

/** Where a Club's Board is. */
const boardHref = (club: ClubInfo) => `/clubs/${club.token}?tab=board`;

/**
 * What a member of the post's Club can do from the timeline: like it (never their own), open its
 * replies, and report it. Reports reach that Club's Moderators, who are the only ones who can hide it.
 */
function JoinedActions({ post, club, open, onToggle }: { post: TimelinePost; club: ClubInfo; open: boolean; onToggle: () => void }) {
  const { like, report } = useClubActions(post.club);
  const replies = post.replies ?? 0;
  return (
    <>
      <button
        type="button"
        className={`post-like ${post.liked ? "post-like-on" : ""}`}
        aria-pressed={post.liked}
        aria-label={post.liked ? "Take back your like" : "Like this post"}
        disabled={post.mine}
        onClick={() => like.mutate({ id: post.id, like: !post.liked })}
      >
        <HeartIcon className="size-4" filled={post.liked} />
        {post.likes > 0 ? post.likes : "Like"}
      </button>
      {(!club.archived || replies > 0) && (
        <button type="button" className={`post-like ${open ? "post-like-on" : ""}`} aria-expanded={open} onClick={onToggle}>
          <ChatIcon className="size-4" />
          {replies > 0 ? replies : "Reply"}
        </button>
      )}
      <Link href={boardHref(club)} className="ml-auto text-xs font-extrabold text-muted underline-offset-2 hover:text-[#111318] hover:underline">
        Open the Board <span aria-hidden>→</span>
      </Link>
      {!post.mine && (
        <ActionMenu
          label="Post actions"
          groups={[
            [
              {
                label: "Report",
                icon: <FlagIcon />,
                confirm: "Report this post?",
                confirmNote: "The Club’s moderators will be asked to look at it. Nothing is hidden until one of them decides.",
                confirmLabel: "Report",
                onSelect: () => report.mutate(post.id),
              },
            ],
          ]}
        />
      )}
    </>
  );
}

/** The post's replies and a box to add one. Read only once it is opened, like the Board's. */
function CardThread({ post, archived, now }: { post: TimelinePost; archived: boolean; now: number }) {
  const me = useClubMembership(post.club);
  const page = useClubPage(post.club);
  // The same rule as the Board's composer: a "holders only" Club lets staff and Holders reply.
  const holdersOnly = page?.holdersOnlyPosts === true && me.member && !me.holder && !(me.role && isStaff(me.role));
  return (
    <Thread parent={post.id} context={{ token: post.club, wallet: me.wallet, canReply: !!me.member && !archived && !holdersOnly }} role={me.role} now={now} />
  );
}

/**
 * One post on the timeline (ADR 0041): the Club it was made in on a cover of its own colours, then
 * the author and the post, set larger and with more room than a row of the Board. A reader who
 * belongs to the Club can like and reply here; anyone else reads, and the cover takes them to the Club to join.
 * Moderation stays on the Board, where the Club's tools are.
 */
export function TimelineCard({ post, club, joined, now }: { post: TimelinePost; club: ClubInfo; joined: boolean; now: number }) {
  const [open, setOpen] = useState(false);
  const quote = post.text !== null && post.text.length <= QUOTE_MAX && !post.link;
  const replies = post.replies ?? 0;

  return (
    <li className="tl-card">
      <Link href={boardHref(club)} className="tl-club group" aria-label={`${club.name}: open its Board`}>
        <ClubCover club={club} className="tl-cover" markClassName="text-[3rem]">
          <span className="relative z-10 flex items-center gap-2.5 px-4 py-2.5">
            <ClubAvatar club={club} className="size-8 text-xs" sizes="32px" />
            <span className="min-w-0 flex-1 truncate text-sm font-black group-hover:underline">{club.name}</span>
            {post.kind === "looking" && (
              <span className="chip chip-dark">
                <SearchIcon />
                Looking for
              </span>
            )}
          </span>
        </ClubCover>
      </Link>

      <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <WalletAvatar seed={post.wallet} size="2.25rem" link />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm">
            <Who address={post.wallet} mine={post.mine} />
            <span className="text-xs text-muted">{ago(Math.floor(post.at / 1000), now)}</span>
          </div>
          {post.signed && (
            <Tooltip content="Signed by this wallet: the post is the author’s own record, and anyone can check it in the Club’s feed export.">
              <span className="chip">
                <BadgeCheckIcon />
                Signed
              </span>
            </Tooltip>
          )}
        </div>

        {post.text !== null && (
          <PostText club={post.club} text={post.text} className={`post-text break-words whitespace-pre-wrap ${quote ? "tl-quote" : "text-base leading-7"}`} />
        )}
        {post.link?.kind === "x" && <XPostCard id={post.link.id} card={post.x} now={now} />}
        {post.link && post.link.kind !== "x" && (
          <Link href={linkHref(post.link)} className="post-link">
            <SwapIcon className="size-4" />
            {linkLabel(post.link)}
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>

      {/* Outside the reader's Clubs the counts are all there is to show; how to join is said once, above the feed. */}
      {(joined || post.likes > 0 || replies > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#111318]/10 px-4 py-2.5 sm:px-5">
          {joined ? (
            <JoinedActions post={post} club={club} open={open} onToggle={() => setOpen(!open)} />
          ) : (
            <>
              {post.likes > 0 && (
                <span className="post-like">
                  <HeartIcon className="size-4" />
                  {post.likes}
                </span>
              )}
              {replies > 0 && (
                <span className="post-like">
                  <ChatIcon className="size-4" />
                  {replies}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {open && joined && (
        <div className="px-4 pb-4 sm:px-5">
          <CardThread post={post} archived={club.archived} now={now} />
        </div>
      )}
    </li>
  );
}
