"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Empty, Loading } from "@/app/clubs/[address]/parts";
import { ClubAvatar } from "@/components/ClubArt";
import { LoadError } from "@/components/ErrorPanel";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { Masonry } from "@/components/Masonry";
import { SystemGroup } from "@/components/SystemMessage";
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
import { estimateHeight, systemHeight, type TimelinePost } from "@/lib/timeline";
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

const heightOf = (item: FeedItem<TimelinePost>) => (item.type === "post" ? estimateHeight(item.post) : systemHeight(item.events.length));
const clubOf = (token: string) => CLUBS.get(token);

/**
 * The reader's Clubs' posts as cards, endlessly (the next page loads as the end nears), with what
 * happened in those Clubs set among them as system messages (ADR 0043), and what to say when there
 * is nothing.
 */
function Feed({ now, empty }: { now: number; empty: React.ReactNode }) {
  const feed = useTimeline("joined");
  const system = useSystemMessages("timeline");
  // Messages are set among the posts by time, down as far as the posts have loaded.
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
          if (item.type === "system") return <SystemGroup key={`system:${item.events[0]!.id}`} events={item.events} now={now} clubs={clubOf} />;
          const club = CLUBS.get(item.post.club);
          return club ? <TimelineCard key={`${item.post.club}:${item.post.id}`} post={item.post} club={club} joined now={now} /> : null;
        }}
      />
      <InfiniteSentinel hasMore={!!feed.hasMore} loading={feed.loadingMore} count={feed.posts.length} failed={feed.loadMoreFailed} onLoadMore={feed.loadMore} />
    </>
  );
}

/**
 * The timeline (ADR 0041): what people are saying on the Boards of the reader's Clubs, in one place,
 * where they can like and reply. Other Clubs aren't listed: the Clubs page is where to find them.
 */
export default function TimelinePage() {
  const now = useNow(30_000);
  const signedIn = !!useAccessToken();
  const signIn = useSignIn();
  const mine = useMyClubs();
  const mineClubs = useMemo(() => mine.flatMap((token) => CLUBS.get(token.toLowerCase()) ?? []), [mine]);
  // An archived Club's Board is frozen, so it isn't somewhere to post.
  const postable = useMemo(() => mineClubs.filter((club) => !club.archived), [mineClubs]);
  // Without Privy the app has no members, so there is no "your Clubs" to show.
  const hasAccounts = signedIn || !!signIn;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Timeline</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">What members are saying on the Boards of your Clubs, and what is happening in them, newest first.</p>
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

      {!hasAccounts && (
        <Empty title="No timeline on this server">The timeline shows the Clubs you’ve joined, and this server has no sign-in.</Empty>
      )}
    </>
  );
}
