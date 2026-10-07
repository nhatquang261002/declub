"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionMenu, type MenuAction } from "@/components/ActionMenu";
import { FollowButton } from "@/components/FollowButton";
import { BadgeCheckIcon, BanIcon, ChatIcon, HeartIcon, ExternalIcon, EyeIcon, EyeOffIcon, FlagIcon, PinIcon, SwapIcon, TrashIcon, XLogoIcon } from "@/components/Icons";
import { Tooltip } from "@/components/Tooltip";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { Spinner } from "@/components/Spinner";
import { useClubActions, useClubReplies } from "@/hooks/useClubBoard";
import { POST_MAX, type PostLink, type PublicPost, type StoredXCard } from "@/lib/clubPosts";
import { isXImage } from "@/lib/xPosts";
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
      {isXImage(card?.image) && (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="x-card-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.image} alt="Picture from the X post" loading="lazy" referrerPolicy="no-referrer" />
        </a>
      )}
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="x-card-open">
        View on X <ExternalIcon className="size-3" />
      </a>
    </div>
  );
}

export type PostActions = {
  report: (id: string) => void;
  like: (id: string, like: boolean) => void;
  remove: (id: string) => void;
  hide: (id: string, hidden: boolean) => void;
  pin: (id: string, pinned: boolean) => void;
  ban: (id: string) => void;
  /** The post whose like is on its way to the server, if any. */
  liking?: string;
};

// Reports no longer hide a post (ADR 0040); posts they hid before stay hidden until staff act.
const HIDDEN_NOTE = { reports: "Hidden after reports", moderator: "Hidden by a moderator" } as const;

/** What a post needs to open its thread (ADR 0032): the Club, and the reader's Club wallet to sign replies with. */
export type ThreadContext = { token: string; wallet?: string; canReply: boolean };

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
  thread,
}: {
  post: PublicPost;
  /** Set on a top-level post to offer its replies; left out on a reply. */
  thread?: ThreadContext;
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
    own.push({ label: "Report", icon: <FlagIcon />, confirm: "Report this post?",
      confirmNote: "The Club’s moderators will be asked to look at it. Nothing is hidden until one of them decides.",
      confirmLabel: "Report",
      onSelect: () => actions.report(post.id) });
  }
  if (role !== undefined && (post.mine || staff)) {
    own.push({
      label: "Delete",
      icon: <TrashIcon />,
      danger: true,
      confirm: post.parent ? "Delete this reply?" : post.replies ? "Delete this post and its replies?" : "Delete this post?",
      confirmNote: "This can’t be undone.",
      onSelect: () => actions.remove(post.id),
    });
  }
  const moderate: MenuAction[] = [];
  // A post an old report hid keeps its pin (a restore puts it back); the Owner may still take it off.
  if (owner && !post.parent && (!post.hidden || post.pinned)) {
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
      confirm: "Ban this member?",
      confirmNote: "They are removed from the Club and can’t rejoin.",
      confirmLabel: "Ban",
      onSelect: () => actions.ban(post.id),
    });
  }

  const [open, setOpen] = useState(false);
  const offersThread = thread !== undefined && !post.hidden && (thread.canReply || (post.replies ?? 0) > 0);

  return (
    <li className={`post ${post.parent ? "post-reply" : ""} ${post.pinned ? "post-pinned" : ""} ${post.hidden ? "post-hidden" : ""}`}>
      <WalletAvatar seed={post.wallet} size={post.parent ? "2rem" : "2.5rem"} />
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
        {role !== undefined && !post.hidden && (
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              className={`post-like ${post.liked ? "post-like-on" : ""}`}
              aria-pressed={post.liked}
              aria-label={post.liked ? "Take back your like" : "Like this post"}
              aria-busy={actions.liking === post.id}
              disabled={post.mine || actions.liking === post.id}
              onClick={() => actions.like(post.id, !post.liked)}
            >
              <HeartIcon className="size-4" filled={post.liked} />
              {post.likes > 0 && post.likes}
            </button>
            {offersThread && <ReplyToggle count={post.replies ?? 0} open={open} onToggle={() => setOpen(!open)} />}
          </div>
        )}
        {role === undefined && !post.hidden && (post.likes > 0 || (offersThread && (post.replies ?? 0) > 0)) && (
          <div className="mt-1 flex gap-2">
            {post.likes > 0 && (
              <span className="post-like w-fit">
                <HeartIcon className="size-4" />
                {post.likes}
              </span>
            )}
            {offersThread && <ReplyToggle count={post.replies ?? 0} open={open} onToggle={() => setOpen(!open)} />}
          </div>
        )}
        {post.link && post.link.kind !== "x" && (
          <Link href={linkHref(post.link)} className="post-link mt-1">
            <SwapIcon className="size-4" />
            {linkLabel(post.link)}
            <span aria-hidden>→</span>
          </Link>
        )}
        {open && thread && <Thread parent={post.id} context={thread} role={role} now={now} />}
      </div>
    </li>
  );
}

function ReplyToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`post-like ${open ? "post-like-on" : ""}`} aria-expanded={open} onClick={onToggle}>
      <ChatIcon className="size-4" />
      {count > 0 ? count : "Reply"}
    </button>
  );
}

/**
 * A post's replies, one level deep (ADR 0032), and a box to add one. Replies use the same menu as
 * posts (like, report, delete, hide, ban) and are signed the same way. They count toward Club Rewards as backing (ADR 0038).
 */
function Thread({ parent, context, role, now }: { parent: string; context: ThreadContext; role: ViewerRole | undefined; now: number }) {
  const { replies, isLoading } = useClubReplies(context.token, parent, true);
  const { reply, replyStage, report, like, remove, hide, ban } = useClubActions(context.token);
  const [text, setText] = useState("");
  const actions: PostActions = {
    report: (id) => report.mutate(id),
    like: (id, on) => like.mutate({ id, like: on }),
    remove: (id) => remove.mutate(id),
    hide: (id, hidden) => hide.mutate({ id, hidden }),
    pin: () => {},
    ban: (id) => ban.mutate({ post: id }),
    liking: like.isPending ? like.variables?.id : undefined,
  };
  const length = [...text].length;

  return (
    <div className="mt-2 rounded-xl border-2 border-[#111318]/15 bg-white/60">
      {isLoading ? (
        <p className="p-3 text-xs text-muted">Loading replies…</p>
      ) : (
        replies.length > 0 && (
          <ul>
            {replies.map((r) => (
              <PostItem key={r.id} post={r} role={role} actions={actions} now={now} />
            ))}
          </ul>
        )
      )}
      {context.canReply && (
        <form
          className="flex items-end gap-2 border-t border-[#111318]/10 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            reply.mutate({ parent, text, wallet: context.wallet }, { onSuccess: () => setText("") });
          }}
        >
          <label className="sr-only" htmlFor={`reply-${parent}`}>
            Your reply
          </label>
          <textarea
            id={`reply-${parent}`}
            className="input min-h-10 flex-1 resize-y border-2 border-[#111318]/25 bg-white text-sm focus:border-[#111318]"
            rows={1}
            value={text}
            maxLength={POST_MAX * 2}
            placeholder="Write a reply"
            readOnly={reply.isPending}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="btn-primary px-3 py-2 text-sm" aria-busy={reply.isPending} disabled={reply.isPending || length === 0 || length > POST_MAX}>
            {reply.isPending && <Spinner />}
            {reply.isPending ? (replyStage === "sending" ? "Sending…" : "Confirm in wallet…") : "Reply"}
          </button>
        </form>
      )}
    </div>
  );
}
