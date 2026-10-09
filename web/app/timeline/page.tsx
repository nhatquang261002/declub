"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { Empty, Loading } from "@/app/clubs/[address]/parts";
import { ClubAvatar } from "@/components/ClubArt";
import { LoadError } from "@/components/ErrorPanel";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { Masonry } from "@/components/Masonry";
import { ChallengeFeedCard, ChallengeSummary } from "@/components/ChallengeCard";
import { SystemGroup } from "@/components/SystemMessage";
import { TimelineCard } from "@/components/TimelineCard";
import { TimelineComposer } from "@/components/TimelineComposer";
import { useAccessToken } from "@/hooks/useAccessToken";
import { useTimelineChallenges } from "@/hooks/useChallenges";
import { useMyClubs } from "@/hooks/useClubMembership";
import { useNow } from "@/hooks/useNow";
import { useSignIn } from "@/hooks/useSignIn";
import { useSystemMessages } from "@/hooks/useSystemMessages";
import { useTimeline } from "@/hooks/useTimeline";
import { toClubInfo, type ClubInfo } from "@/lib/clubs";
import { weave, withoutPinned, type FeedItem } from "@/lib/systemFeed";
import { estimateHeight, systemHeight, type TimelinePost } from "@/lib/timeline";
import { registry } from "@/lib/verifiedAssets";

/** Every Club the app knows, by lowercase token: a post names its Club by token and the page draws it from here. */
const CLUBS = new Map<string, ClubInfo>(registry.clubs().map((entry) => [entry.address.toLowerCase(), toClubInfo(entry)]));

const heightOf = (item: FeedItem<TimelinePost>) =>
  item.type === "post" ? estimateHeight(item.post) : item.type === "challenge" ? CHALLENGE_HEIGHT : systemHeight(item.events.length);
const clubOf = (token: string) => CLUBS.get(token);
/** About how tall a challenge's card is, for laying the masonry out before it has loaded. */
const CHALLENGE_HEIGHT = 480;

/** Which Clubs the timeline shows: every Club, or only the ones the reader has joined. It lives in the URL (`?show=joined`). */
type Show = "all" | "joined";

/**
 * Posts as cards, endlessly (the next page loads as the end nears), with what happened in those
 * Clubs set among them as system messages (ADR 0043), the challenges still running pinned on top
 * (ADR 0045), and what to say when there is nothing. A card is read-only in a Club the reader hasn't joined.
 */
function Feed({ show, joined, now, empty }: { show: Show; joined: ReadonlySet<string>; now: number; empty: React.ReactNode }) {
  const feed = useTimeline(show);
  const system = useSystemMessages(show === "joined" ? "timeline" : "everywhere");
  // Challenges still running are pinned on top, as on a Board (ADR 0045), so the feed leaves out their start.
  const pinned = useTimelineChallenges(show);
  // Messages are set among the posts by time, down as far as the posts have loaded.
  const items = useMemo(() => {
    const events = withoutPinned(system.events, new Set(pinned.map((p) => p.challenge.id)));
    return weave(feed.posts, events, { since: system.since, complete: !feed.hasMore });
  }, [feed.posts, feed.hasMore, system.events, system.since, pinned]);
  if (feed.error && feed.posts.length === 0) return <LoadError title="Couldn’t load the timeline" error={feed.error} />;
  if (!feed.enabled) return <Empty title="No timeline on this server">This server isn’t keeping Club boards.</Empty>;

  return (
    <>
      {pinned.length > 0 && (
        <ul className="mb-4 flex flex-col gap-3" aria-label="Pinned challenges">
          {pinned.map(({ club, challenge: c }) => (
            <li key={`${club}:${c.id}`}>
              <ChallengeSummary
                c={c}
                token={club}
                now={now}
                club={clubOf(club)}
                heading={c.phase === "open" ? "Challenge" : "Challenge ended"}
                pinned
                compact={pinned.length > 1}
              />
            </li>
          ))}
        </ul>
      )}
      {feed.isLoading ? (
        <Loading label="Loading the timeline" rows={3} />
      ) : items.length === 0 ? (
        pinned.length === 0 ? (
          empty
        ) : null
      ) : (
        <>
          <Masonry
            as="ul"
            items={items}
            height={heightOf}
            render={(item) => {
              if (item.type === "challenge") return <ChallengeFeedCard key={`challenge:${item.event.id}`} event={item.event} now={now} clubs={clubOf} />;
              if (item.type === "system") return <SystemGroup key={`system:${item.events[0]!.id}`} events={item.events} now={now} clubs={clubOf} />;
              const club = CLUBS.get(item.post.club);
              return club ? (
                <TimelineCard key={`${item.post.club}:${item.post.id}`} post={item.post} club={club} joined={joined.has(item.post.club)} now={now} />
              ) : null;
            }}
          />
          <InfiniteSentinel
            hasMore={!!feed.hasMore}
            loading={feed.loadingMore}
            count={feed.posts.length}
            failed={feed.loadMoreFailed}
            onLoadMore={feed.loadMore}
          />
        </>
      )}
    </>
  );
}

const SHOWS: { value: Show; label: string }[] = [
  { value: "all", label: "All Clubs" },
  { value: "joined", label: "Joined Clubs" },
];

/**
 * The timeline (ADR 0041): what people are saying on the Clubs' Boards, in one place, every Club
 * or only the reader's own. In their own Clubs they can like and reply; elsewhere they can read.
 */
export default function TimelinePage() {
  // The filter lives in the URL (?show=joined), so it can be linked and survives a reload.
  return (
    <Suspense>
      <Timeline />
    </Suspense>
  );
}

function Timeline() {
  const now = useNow(30_000);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const signedIn = !!useAccessToken();
  const signIn = useSignIn();
  const mine = useMyClubs();
  const joined = useMemo(() => new Set(mine.map((token) => token.toLowerCase())), [mine]);
  const mineClubs = useMemo(() => [...joined].flatMap((token) => CLUBS.get(token) ?? []), [joined]);
  // An archived Club's Board is frozen, so it isn't somewhere to post.
  const postable = useMemo(() => mineClubs.filter((club) => !club.archived), [mineClubs]);
  // Without Privy the app has no members, so there is no "your Clubs" to filter to.
  const hasAccounts = signedIn || !!signIn;
  const show: Show = hasAccounts && search.get("show") === "joined" ? "joined" : "all";
  const setShow = (next: Show) => {
    const params = new URLSearchParams(search);
    if (next === "all") params.delete("show");
    else params.set("show", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Timeline</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">What members are saying on the Clubs’ Boards, and what is happening in them, newest first.</p>
      </div>

      {hasAccounts && (
        <div className="tabbar mb-4 flex w-full sm:inline-flex sm:w-auto" role="group" aria-label="Which Clubs to show">
          {SHOWS.map((s) => (
            <button
              key={s.value}
              type="button"
              className="tab inline-flex flex-1 items-center justify-center gap-1.5 sm:flex-none"
              aria-pressed={show === s.value}
              onClick={() => setShow(s.value)}
            >
              {s.label}
              {s.value === "joined" && signedIn && <span className="tab-count">{mineClubs.length.toLocaleString()}</span>}
            </button>
          ))}
        </div>
      )}

      {show === "joined" && mineClubs.length > 0 && (
        <ul className="mb-6 flex flex-wrap gap-2" aria-label="Your Clubs">
          {mineClubs.map((club) => (
            <li key={club.token}>
              <Link href={`/clubs/${club.token}`} className="chip py-1 pr-3 pl-1 text-xs hover:bg-white">
                <ClubAvatar club={club} className="size-5 text-[0.5rem]" sizes="20px" />
                {club.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {signedIn && postable.length > 0 && (
        <div className="mt-2 mb-6">
          <TimelineComposer clubs={postable} />
        </div>
      )}

      {show === "joined" && !signedIn ? (
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
          Posts from the Clubs you’ve joined collect here, and you can post to them from this page.
        </Empty>
      ) : (
        <Feed
          // A new filter is a new list, from the top.
          key={show}
          show={show}
          joined={joined}
          now={now}
          empty={
            show === "all" ? (
              <Empty title="Nothing posted yet">When members post on their Clubs’ Boards, it shows up here.</Empty>
            ) : mine.length === 0 ? (
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
      )}
    </>
  );
}
