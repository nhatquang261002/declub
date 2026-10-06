"use client";

import Link from "next/link";
import { ActionMenu, type MenuAction } from "@/components/ActionMenu";
import { FollowButton } from "@/components/FollowButton";
import { BadgeCheckIcon, BanIcon, ExternalIcon, EyeIcon, EyeOffIcon, FlagIcon, PinIcon, SwapIcon, TrashIcon, XLogoIcon } from "@/components/Icons";
import { Tooltip } from "@/components/Tooltip";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import type { PostLink, PublicPost, StoredXCard } from "@/lib/clubPosts";
import { isOwnerOrAdmin, isStaff } from "@/lib/clubRoles";
import { ago, shortAddress } from "@/lib/format";
import type { ViewerRole } from "@/hooks/useClubMembership";
import type { useFollows } from "@/hooks/useSocial";

type AppLink = Exclude<PostLink, { kind: "x" }>;

/** Where a linked deal or signed swap lives in the app. */
const linkHref = (link: AppLink) => (link.kind === "deal" ? `/v2/deal/${link.id}` : `/intent/${link.hash}`);
const linkLabel = (link: AppLink) => (link.kind === "deal" ? `Deal #${link.id}` : `Signed swap ${shortAddress(link.hash)}`);

/**
 * A shared X post (ADR 0024), drawn from what the server read: no X script, and the text is plain
 * text like a post's. It opens on X.
 */
function XPostCard({ id, card, now }: { id: string; card?: StoredXCard; now: number }) {
  const href = card ? `https://x.com/${card.author}/status/${card.id}` : `https://x.com/i/status/${id}`;
  return (
    <div className="x-card mt-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <XLogoIcon className="size-3.5" />
        {card ? <span className="font-bold">@{card.author}</span> : <span className="font-bold">X post</span>}
        {card?.postedAt && <span className="text-muted">· {ago(Math.floor(card.postedAt / 1000), now)}</span>}
        {card?.own && (
          <Tooltip content="Posted from the X account this member linked to their profile.">
            <span className="chip">Their own post</span>
          </Tooltip>
        )}
        {card?.counted && (
          <Tooltip
            content={
              card.counted === "strong"
                ? "A Holder’s own post about this Club: it counts toward their Momentum and Holder bonus."
                : "A Holder’s own post that only matched one of the Club’s tags: it counts half."
            }
          >
            <span className="chip chip-peach">Counts{card.counted === "weak" ? " · half" : ""}</span>
          </Tooltip>
        )}
      </span>
      {card && <p className="x-card-text">{card.text}</p>}
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="x-card-open">
        View on X <ExternalIcon className="size-3" />
      </a>
    </div>
  );
}

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
  follows,
}: {
  post: PublicPost;
  /** The reader's follows, for the Follow button beside the author. */
  follows?: ReturnType<typeof useFollows>;
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
            {follows && <FollowButton target={post.wallet} follows={follows} />}
            <span className="text-xs text-muted">· {ago(Math.floor(post.at / 1000), now)}</span>
            {post.signed && (
              <Tooltip content="Signed by this wallet: the post is the author’s own record, and anyone can check it in the Club’s feed export.">
                <span className="chip">
                  <BadgeCheckIcon />
                  Signed
                </span>
              </Tooltip>
            )}
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
        {post.link?.kind === "x" && <XPostCard id={post.link.id} card={post.x} now={now} />}
        {post.link && post.link.kind !== "x" && (
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
