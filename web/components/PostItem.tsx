"use client";

import Link from "next/link";
import { ActionMenu, type MenuAction } from "@/components/ActionMenu";
import { BanIcon, EyeIcon, EyeOffIcon, FlagIcon, PinIcon, SwapIcon, TrashIcon } from "@/components/Icons";
import { WalletAvatar } from "@/components/WalletAvatar";
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

/**
 * One post. The text is plain text: React escapes it and nothing here turns it into a link, so
 * what a member types can't become markup or a clickable address. What each viewer may do is
 * decided by the server; the menu only follows the viewer's role so they aren't offered actions
 * that would be refused.
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

  const own: MenuAction[] = [];
  if (role !== undefined && !post.mine && !post.hidden) {
    own.push({ label: "Report", icon: <FlagIcon />, confirm: "Report this post to the Club’s moderators?", onSelect: () => actions.report(post.id) });
  }
  if (role !== undefined && (post.mine || staff)) {
    own.push({ label: "Delete", icon: <TrashIcon />, danger: true, confirm: "Delete this post?", onSelect: () => actions.remove(post.id) });
  }
  const moderate: MenuAction[] = [];
  // A post hidden by reports keeps its pin (a restore puts it back); the Owner may still take it off.
  if (owner && (!post.hidden || post.pinned)) {
    moderate.push({ label: post.pinned ? "Unpin" : "Pin to top", icon: <PinIcon />, onSelect: () => actions.pin(post.id, !post.pinned) });
  }
  if (staff && !post.mine) {
    moderate.push({
      label: post.hidden ? "Restore" : "Hide",
      icon: post.hidden ? <EyeIcon /> : <EyeOffIcon />,
      onSelect: () => actions.hide(post.id, !post.hidden),
    });
    moderate.push({
      label: "Ban author",
      icon: <BanIcon />,
      danger: true,
      confirm: "Ban this member from the Club? They are removed and can’t rejoin.",
      onSelect: () => actions.ban(post.id),
    });
  }

  return (
    <li className={`post ${post.pinned ? "post-pinned" : ""} ${post.hidden ? "post-hidden" : ""}`}>
      <WalletAvatar seed={post.wallet} size="2.5rem" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Who address={post.wallet} mine={post.mine} />
            <span className="text-xs text-muted">· {ago(Math.floor(post.at / 1000), now)}</span>
            {post.pinned && (
              <span className="chip">
                <PinIcon />
                Pinned
              </span>
            )}
            {post.kind === "looking" && <span className="chip chip-peach">Looking for</span>}
          </div>
          <div className="-my-1 -mr-1">
            <ActionMenu label="Post actions" groups={[own, moderate]} />
          </div>
        </div>

        {post.hidden && (
          <p className="w-fit">
            <span className="chip chip-warn">
              <EyeOffIcon />
              {HIDDEN_NOTE[post.hidden]}
              {post.reports !== undefined && ` · ${post.reports} ${post.reports === 1 ? "report" : "reports"}`}
            </span>
            {post.text !== null && <span className="ml-2 text-xs text-muted">Only you and the Club’s moderators can see it.</span>}
          </p>
        )}
        {!post.hidden && post.reports !== undefined && post.reports > 0 && (
          <p className="w-fit">
            <span className="chip chip-warn">
              <FlagIcon />
              {post.reports} {post.reports === 1 ? "report" : "reports"}
            </span>
          </p>
        )}
        {post.text !== null && <p className="post-text text-[0.95rem] leading-6 break-words whitespace-pre-wrap">{post.text}</p>}
        {post.link && (
          <Link href={linkHref(post.link)} className="post-link mt-1">
            <SwapIcon className="size-4" />
            {linkLabel(post.link)}
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </li>
  );
}
