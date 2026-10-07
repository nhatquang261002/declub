"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Empty, Loading } from "@/app/clubs/[address]/parts";
import { ClubAvatar } from "@/components/ClubArt";
import { LoadError } from "@/components/ErrorPanel";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { Masonry } from "@/components/Masonry";
import { SystemMessage } from "@/components/SystemMessage";
import { TimelineCard } from "@/components/TimelineCard";
import { TimelineComposer } from "@/components/TimelineComposer";
import { useAccessToken } from "@/hooks/useAccessToken";
import { useMyClubs } from "@/hooks/useClubMembership";
import { useNow } from "@/hooks/useNow";
import { useSignIn } from "@/hooks/useSignIn";
import { useSystemMessages } from "@/hooks/useSystemMessages";
import { useTimeline } from "@/hooks/useTimeline";
import { toClubInfo, type ClubInfo } from "@/lib/clubs";
import { weave, type FeedItem } from "@/lib/systemFeed";
import { estimateHeight, SYSTEM_HEIGHT, type TimelinePost, type TimelineScope } from "@/lib/timeline";
import { registry } from "@/lib/verifiedAssets";

/** Every Club the app knows, by lowercase token: a post names its Club by token and the page draws it from here. */
const CLUBS = new Map<string, ClubInfo>(registry.clubs().map((entry) => [entry.address.toLowerCase(), toClubInfo(entry)]));

function Section({ id, title, children, aside }: { id: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-12">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id={id} className="text-xl font-black tracking-tight sm:text-2xl">
            {title}
          </h2>
          {aside}
        </div>
      </div>
      {children}
    </section>
  );
}

const heightOf = (item: FeedItem<TimelinePost>) => (item.type === "post" ? estimateHeight(item.post) : SYSTEM_HEIGHT);

/** One scope of the timeline: its posts as cards, endlessly (the next page loads as the end nears), and what to say when there are none. */
function Feed({ scope, joined, now, empty }: { scope: TimelineScope; joined: boolean; now: number; empty: React.ReactNode }) {
  const feed = useTimeline(scope);
  const system = useSystemMessages({ scope });
  // System messages (ADR 0043) are set among the posts by time, down as far as the posts have loaded.
  const items = useMemo(() => weave(feed.posts, system.events, { since: system.since, complete: !feed.hasMore }), [feed.posts, feed.hasMore, system.events, system.since]);
  if (feed.error && feed.posts.length === 0) return <LoadError title="Couldn’t load the timeline" error={feed.error} />;
  if (!feed.enabled) return <Empty title="No timeline on this server">This server isn’t keeping Club boards.</Empty>;
  if (feed.isLoading) return <Loading label="Loading the timeline" rows={3} />;
  if (items.length === 0) return <>{empty}</>;

  return (
    <>
      <Masonry
        as="ul"
        items={items}
        height={heightOf}
        render={(item) => {
          const post = item.type === "post" ? item.post : null;
          const club = CLUBS.get(post ? post.club : item.type === "system" ? item.event.club : "");
          if (!club) return null;
          return item.type === "system" ? (
            <SystemMessage key={`system:${item.event.club}:${item.event.id}`} event={item.event} club={club} now={now} />
          ) : (
            <TimelineCard key={`${item.post.club}:${item.post.id}`} post={item.post} club={club} joined={joined} now={now} />
          );
        }}
      />
      <InfiniteSentinel hasMore={!!feed.hasMore} loading={feed.loadingMore} count={feed.posts.length} failed={feed.loadMoreFailed} onLoadMore={feed.loadMore} />
    </>
  );
}

/**
 * The timeline (ADR 0041): what people are saying on the Clubs' Boards, in one place. A reader's own
 * Clubs come first, set in a single column they can like and reply in; then the other Clubs'
 * posts, in cards that name the Club they came from, so there is a reason to open one.
 */
export default function TimelinePage() {
  const now = useNow(30_000);
  const signedIn = !!useAccessToken();
  const signIn = useSignIn();
  const mine = useMyClubs();
  const mineClubs = useMemo(() => mine.flatMap((token) => CLUBS.get(token.toLowerCase()) ?? []), [mine]);
  // An archived Club's Board is frozen, so it isn't somewhere to post.
  const postable = useMemo(() => mineClubs.filter((club) => !club.archived), [mineClubs]);
  // The same query the "others" feed below runs, so this costs nothing. A member of every Club with
  // posts has them all above, and an empty "other Clubs" section would only say there is nothing.
  const others = useTimeline("others");
  const showOthers = !signedIn || others.isLoading || others.posts.length > 0 || !!others.error;
  // Without Privy the app has no members, so there is no "your Clubs" to show.
  const hasAccounts = signedIn || !!signIn;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Timeline</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">What members are saying on the Clubs’ Boards, newest first. Yours come first, then the rest of the Clubs.</p>
        {hasAccounts && showOthers && (
          <p className="mt-2 text-sm">
            <a href="#around" className="font-bold underline underline-offset-2">
              Skip to the other Clubs ↓
            </a>
          </p>
        )}
      </div>

      {hasAccounts && (
        <Section
          id="yours"
          title="From your Clubs"
          aside={
            mineClubs.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Your Clubs">
                {mineClubs.map((club) => (
                  <li key={club.token}>
                    <Link href={`/clubs/${club.token}`} className="chip py-1 pr-3 pl-1 text-xs hover:bg-white">
                      <ClubAvatar club={club} className="size-5 text-[0.5rem]" sizes="20px" />
                      {club.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }
        >
          {!signedIn ? (
            <Empty
              title="Sign in to see your Clubs here"
              action={
                signIn && (
                  <button type="button" className="btn-primary" onClick={signIn}>
                    Sign in
                  </button>
                )
              }
            >
              Posts from the Clubs you’ve joined collect on this page, and you can post to them from here.
            </Empty>
          ) : (
            <>
              {postable.length > 0 && (
                <div className="mb-6">
                  <TimelineComposer clubs={postable} />
                </div>
              )}
              <Feed
              scope="joined"
              joined
              now={now}
              empty={
                mine.length === 0 ? (
                  <Empty
                    title="You haven’t joined a Club yet"
                    action={
                      <Link href="/clubs" className="btn-primary">
                        Find a Club
                      </Link>
                    }
                  >
                    Join one and its posts show up here.
                  </Empty>
                ) : (
                  <Empty title="Nothing posted in your Clubs yet">Say hello above and it will show up here.</Empty>
                )
              }
            />
            </>
          )}
        </Section>
      )}

      {showOthers && (
        <Section id="around" title={hasAccounts ? "Around the other Clubs" : "Around the Clubs"}>
          <Feed scope="others" joined={false} now={now} empty={<Empty title="No posts yet">When members post on a Club’s Board, it will show up here.</Empty>} />
        </Section>
      )}
    </>
  );
}
