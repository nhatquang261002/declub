"use client";

import Link from "next/link";
import { Who } from "@/components/Who";
import type { PostLink, PublicPost } from "@/lib/clubPosts";
import { isOwnerOrAdmin, isStaff } from "@/lib/clubRoles";
import { ago, shortAddress } from "@/lib/format";
import type { ViewerRole } from "@/hooks/useClubMembership";

/** Where a linked deal or signed swap lives in the app. */
const linkHref = (link: PostLink) => (link.kind === "deal" ? `/v2/deal/${link.id}` : `/intent/${link.hash}`);
const linkLabel = (link: PostLink) => (link.kind === "deal" ? `Deal #${link.id}` : `Signed swap ${shortAddress(link.hash)}`);

export type PostActions = {
  report: (id: string) => void;
  remove: (id: string) => void;
  hide: (id: string, hidden: boolean) => void;
  pin: (id: string, pinned: boolean) => void;
  ban: (id: string) => void;
};

const HIDDEN_NOTE = { reports: "Hidden after reports", moderator: "Hidden by a moderator" } as const;

const act = "text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink";

/**
 * One post. The text is plain text: React escapes it and nothing here turns it into a link, so
 * what a member types can't become markup or a clickable address. What each viewer may do is
 * decided by the server; the buttons only follow the viewer's role so they aren't offered
 * actions that would be refused.
 */
export function PostItem({
  post,
  role,
  actions,
  now,
}: {
  post: PublicPost;
  /** The viewer's role, or undefined when they aren't a member. */
  role: ViewerRole | undefined;
  actions: PostActions;
  now: number;
}) {
  const staff = role !== undefined && isStaff(role);
  const owner = role !== undefined && isOwnerOrAdmin(role);
  const confirm = (message: string, run: () => void) => {
    if (window.confirm(message)) run();
  };

  return (
    <li className="page-section flex flex-col gap-2 px-5 py-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Who address={post.wallet} mine={post.mine} plain />
        {post.kind === "looking" && <span className="rounded-full border border-line px-2 py-0.5 text-xs">Looking for</span>}
        {post.pinned && <span className="rounded-full border border-line px-2 py-0.5 text-xs">Pinned</span>}
        <span className="text-xs text-muted">{ago(Math.floor(post.at / 1000), now)}</span>
      </div>

      {post.hidden && (
        <p className="text-xs text-warn">
          {HIDDEN_NOTE[post.hidden]}
          {post.text !== null && " (only you and the Club’s moderators can see it)"}
          {post.reports !== undefined && ` · ${post.reports} ${post.reports === 1 ? "report" : "reports"}`}
        </p>
      )}
      {post.text !== null && <p className="break-words whitespace-pre-wrap">{post.text}</p>}
      {post.link && (
        <Link href={linkHref(post.link)} className="w-fit text-xs font-semibold underline">
          {linkLabel(post.link)} →
        </Link>
      )}

      {role !== undefined && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {!post.mine && !post.hidden && (
            <button type="button" className={act} onClick={() => confirm("Report this post to the Club’s moderators?", () => actions.report(post.id))}>
              Report
            </button>
          )}
          {(post.mine || staff) && (
            <button type="button" className={act} onClick={() => confirm("Delete this post?", () => actions.remove(post.id))}>
              Delete
            </button>
          )}
          {staff && !post.mine && (
            <button type="button" className={act} onClick={() => actions.hide(post.id, !post.hidden)}>
              {post.hidden ? "Restore" : "Hide"}
            </button>
          )}
          {owner && !post.hidden && (
            <button type="button" className={act} onClick={() => actions.pin(post.id, !post.pinned)}>
              {post.pinned ? "Unpin" : "Pin"}
            </button>
          )}
          {staff && !post.mine && (
            <button type="button" className={act} onClick={() => confirm("Ban this member from the Club? They are removed and can’t rejoin.", () => actions.ban(post.id))}>
              Ban author
            </button>
          )}
        </div>
      )}
    </li>
  );
}
