"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadError } from "@/components/ErrorPanel";
import { Pills } from "@/components/Pills";
import { JoinClubButton } from "@/components/JoinClubButton";
import { PostComposer } from "@/components/PostComposer";
import { PostItem } from "@/components/PostItem";
import { Spinner } from "@/components/Spinner";
import { ChallengeFeedCard, ChallengeSummary } from "@/components/ChallengeCard";
import { SystemGroup } from "@/components/SystemMessage";
import { useChallenges } from "@/hooks/useChallenges";
import { useClubActions, useClubPage, useClubPosts } from "@/hooks/useClubBoard";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useFollows } from "@/hooks/useSocial";
import { useSystemMessages } from "@/hooks/useSystemMessages";
import { isLive } from "@/lib/challenges";
import { isStaff } from "@/lib/clubRoles";
import { LENSES, type LensId } from "@/lib/lenses";
import { weave, withoutPinned } from "@/lib/systemFeed";
import { Empty, Loading } from "./parts";

const FILTERS = [
  { value: "all", label: "All posts" },
  { value: "looking", label: "Looking for" },
] as const;

/** Why the viewer can't post, and what would let them. */
function CantPost({ token, symbol, reason }: { token: string; symbol: string; reason: "join" | "holders" }) {
  return (
    <div className="club-panel mb-5 flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
      <div>
        <p className="font-extrabold">{reason === "join" ? "Join the conversation" : "Only Holders post here"}</p>
        <p className="mt-0.5 text-sm text-muted">
          {reason === "join"
            ? `Members of this Club can post notes and what they’re looking for. Joining shows your wallet on the Members list.`
            : `This Club’s Owner has limited posting to members who hold ${symbol}. You can still read and report.`}
        </p>
      </div>
      {reason === "join" && <JoinClubButton token={token} symbol={symbol} archived={false} hint={false} />}
    </div>
  );
}

/** The Club's board: member posts, newest first, pinned ones on top. */
export function ClubBoard({ token, symbol, archived, now }: { token: string; symbol: string; archived: boolean; now: number }) {
  const follows = useFollows();
  const [lens, setLens] = useState<LensId>("newest");
  // Following needs to know who's reading; without a wallet it falls back to everything.
  const lenses = LENSES.filter((l) => l.id !== "following" || follows.me);
  const active = lenses.find((l) => l.id === lens) ?? lenses[0]!;
  const { enabled, posts, hasMore, loadMore, loadingMore, isLoading, error } = useClubPosts(token, active.id, follows.me);
  const me = useClubMembership(token);
  const page = useClubPage(token);
  const { report, like, remove, hide, pin, ban } = useClubActions(token);
  const [filter, setFilter] = useState<"all" | "looking">("all");
  const system = useSystemMessages({ club: token });
  // Challenges still running (ADR 0045) are pinned on top, whatever the order or filter, so the feed leaves out their start.
  const { challenges } = useChallenges(token);
  const live = useMemo(() => challenges.filter((c) => isLive(c.phase)), [challenges]);
  // System messages (ADR 0043) go among the posts in time order, so only where the list is by time
  // and holds everything: another lens or "Looking for" is a question about posts.
  const byTime = active.id === "newest";
  const items = useMemo(() => {
    const list = filter === "all" ? posts : posts.filter((p) => p.kind === "looking");
    const withSystem = byTime && filter === "all";
    const events = withoutPinned(system.events, new Set(live.map((c) => c.id)));
    return weave(list, withSystem ? events : [], { since: system.since, complete: !hasMore });
  }, [posts, filter, byTime, system.events, system.since, hasMore, live]);

  if (error && posts.length === 0) return <LoadError title="Couldn’t load the board" error={error} />;
  if (!enabled) return <Empty title="No board on this server">This server isn’t keeping Club boards.</Empty>;

  const holdersOnly = page?.holdersOnlyPosts === true && me.member && !me.holder && !(me.role && isStaff(me.role));

  return (
    <>
      {archived ? (
        <p className="mb-5 text-sm text-muted">This Club is archived, so the board is frozen.</p>
      ) : me.member ? (
        holdersOnly ? (
          <CantPost token={token} symbol={symbol} reason="holders" />
        ) : (
          <PostComposer token={token} wallet={me.wallet} xHint={page?.x?.hint} />
        )
      ) : (
        <CantPost token={token} symbol={symbol} reason="join" />
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <Pills value={active.id} options={lenses.map((l) => ({ value: l.id, label: l.name }))} onChange={setLens} label="Order posts by" />
        <Pills value={filter} options={FILTERS} onChange={setFilter} label="Show posts" />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{active.description}</p>
        {me.member && !archived && (
          <p className="text-xs text-muted">
            Posting needs a linked X or Discord account with “Show my X or Discord handle” turned on in your{" "}
            <Link href="/profile" className="font-bold underline">
          Profile
        </Link>
            .
          </p>
        )}
      </div>

      {live.length > 0 && (
        <ul className="mb-4 flex flex-col gap-3" aria-label="Pinned challenges">
          {live.map((c) => (
            <li key={c.id}>
              <ChallengeSummary c={c} token={token} now={now} heading={c.phase === "open" ? "Challenge" : "Challenge ended"} pinned compact={live.length > 1} />
            </li>
          ))}
        </ul>
      )}

      {isLoading ? (
        <Loading label="Loading the board" />
      ) : items.length === 0 ? (
        <Empty
          title={active.id === "following" ? "Nobody you follow has posted here" : filter === "looking" ? "Nobody is looking for anything yet" : "No posts yet"}
        >
          {active.id === "following"
            ? "Follow members from their posts or the Members list to see them here."
            : me.member && !archived
              ? "Start it off: say hello, or post what you’re looking for."
              : "Posts from members will show up here."}
        </Empty>
      ) : (
        <ul className="club-panel club-list">
          {items.map((item) =>
            item.type === "challenge" ? (
              <ChallengeFeedCard key={`challenge:${item.event.id}`} event={item.event} now={now} className="p-3" />
            ) : item.type === "system" ? (
              <SystemGroup key={`system:${item.events[0]!.id}`} events={item.events} now={now} />
            ) : (
              <PostItem
                key={item.post.id}
                post={item.post}
                role={me.role}
                now={now}
                follows={follows}
                thread={{
                  token,
                  wallet: me.wallet,
                  canReply: !!me.member && !archived && !holdersOnly,
                }}
                actions={{
                  report: (id) => report.mutate(id),
                  like: (id, on) => like.mutate({ id, like: on }),
                  remove: (id) => remove.mutate(id),
                  hide: (id, hidden) => hide.mutate({ id, hidden }),
                  pin: (id, pinned) => pin.mutate({ id, pinned }),
                  ban: (id) => ban.mutate({ post: id }),
                }}
              />
            ),
          )}
        </ul>
      )}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn-secondary" aria-busy={loadingMore} disabled={loadingMore} onClick={loadMore}>
            {loadingMore && <Spinner />}
            {loadingMore ? "Loading…" : "Show more posts"}
          </button>
        </div>
      )}
      {!isLoading && posts.length > 0 && (
        <p className="mt-3 text-xs text-muted">Be kind: reports go to the moderators, who can hide and remove posts.</p>
      )}
    </>
  );
}
