"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { Empty, Loading } from "@/app/clubs/[address]/parts";
import { ClubAvatar } from "@/components/ClubArt";
import { LoadError } from "@/components/ErrorPanel";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { Masonry } from "@/components/Masonry";
import { ChallengeFeedCard, ChallengeSummary, ChallengeTiles } from "@/components/ChallengeCard";
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
import type { PublicChallenge } from "@/lib/challenges";
import { weave, type FeedItem } from "@/lib/systemFeed";
import { estimateHeight, systemHeight, type TimelinePost } from "@/lib/timeline";
import { registry } from "@/lib/verifiedAssets";

/** Every Club the app knows, by lowercase token: a post names its Club by token and the page draws it from here. */
const CLUBS = new Map<string, ClubInfo>(registry.clubs().map((entry) => [entry.address.toLowerCase(), toClubInfo(entry)]));

const heightOf = (item: FeedItem<TimelinePost>) =>
  item.type === "post" ? estimateHeight(item.post) : item.type === "challenge" ? CHALLENGE_HEIGHT : systemHeight(item.events.length);
const clubOf = (token: string) => CLUBS.get(token);
/** About how tall a challenge's card is, for laying the masonry out before it has loaded. */
const CHALLENGE_HEIGHT = 480;
/** How many running challenges are pinned above the posts; the rest are under the Challenges filter. */
const PINNED_SHOWN = 3;

/**
 * What the timeline shows: every Club's posts, only the reader's Clubs' posts, or every Club's
 * challenges. It lives in the URL (`?show=joined`, `?show=challenges`).
 */
type Show = "all" | "joined" | "challenges";

const headingOf = (c: PublicChallenge) => (c.phase === "open" ? "Challenge" : c.phase === "settled" ? "Challenge results" : "Challenge ended");

/**
 * Posts as cards, endlessly (the next page loads as the end nears), with what happened in those
 * Clubs set among them as system messages (ADR 0043), the first few challenges still running pinned
 * on top (ADR 0045), and what to say when there is nothing. A card is read-only in a Club the reader hasn't joined.
 */
function Feed({
  show,
  joined,
  now,
  empty,
  onAllChallenges,
}: {
  show: "all" | "joined";
  joined: ReadonlySet<string>;
  now: number;
  empty: React.ReactNode;
  onAllChallenges: () => void;
}) {
  const feed = useTimeline(show);
  const system = useSystemMessages(show === "joined" ? "timeline" : "everywhere");
  const { challenges: running } = useTimelineChallenges(show);
  const pinned = running.slice(0, PINNED_SHOWN);
  // Messages are set among the posts by time, down as far as the posts have loaded. A challenge's
  // start is left out: while it runs it is pinned or under the Challenges filter, and once it is
  // done its result card shows the same challenge, so across many Clubs the starts only crowd the posts.
  const items = useMemo(
    () =>
      weave(
        feed.posts,
        system.events.filter((e) => e.kind !== "challenge"),
        { since: system.since, complete: !feed.hasMore },
      ),
    [feed.posts, feed.hasMore, system.events, system.since],
  );
  if (feed.error && feed.posts.length === 0) return <LoadError title="Couldn’t load the timeline" error={feed.error} />;
  if (!feed.enabled) return <Empty title="No timeline on this server">This server isn’t keeping Club boards.</Empty>;

  return (
    <>
      {pinned.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          <ChallengeTiles items={pinned.map(({ club, challenge: c }) => ({ token: club, c, heading: headingOf(c), club: clubOf(club) }))} now={now} />
          {running.length > pinned.length && (
            <button type="button" className="btn-secondary btn-sm self-start" onClick={onAllChallenges}>
              {/* The filter lists every Club's, so under Joined Clubs the count here would undersell it. */}
              {show === "all" ? `See all ${running.length.toLocaleString()} running challenges` : "See every Club’s challenges"}
            </button>
          )}
        </div>
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

/**
 * Every live Club's challenges (ADR 0045): the running ones, soonest end first, then the newest
 * results. A cancelled challenge isn't listed; it stays on its Club's Challenges tab.
 */
function Challenges({ now }: { now: number }) {
  const { enabled, challenges, isLoading, error } = useTimelineChallenges("all", { past: true });
  if (error && challenges.length === 0) return <LoadError title="Couldn’t load the challenges" error={error} />;
  if (!enabled) return <Empty title="No challenges on this server">This server isn’t keeping Club boards.</Empty>;
  if (isLoading) return <Loading label="Loading the challenges" rows={3} />;
  if (challenges.length === 0) return <Empty title="No challenges yet">When a Club’s Owner sets a challenge, it shows up here.</Empty>;
  const running = challenges.filter((p) => p.challenge.phase !== "settled");
  const done = challenges.filter((p) => p.challenge.phase === "settled");
  const section = (title: string, list: typeof challenges) =>
    list.length > 0 && (
      <section className="flex flex-col gap-3">
        <h2 className="kicker">{title}</h2>
        <Masonry
          as="ul"
          items={list}
          height={() => CHALLENGE_HEIGHT}
          render={({ club, challenge: c }) => (
            <li key={`${club}:${c.id}`}>
              <ChallengeSummary c={c} token={club} now={now} club={clubOf(club)} heading={headingOf(c)} results={c.phase === "settled"} />
            </li>
          )}
        />
      </section>
    );
  return (
    <div className="flex flex-col gap-8">
      {section("Running", running)}
      {section("Ended", done)}
    </div>
  );
}

const SHOWS: { value: Show; label: string; accounts?: true }[] = [
  { value: "all", label: "All Clubs" },
  { value: "joined", label: "Joined Clubs", accounts: true },
  { value: "challenges", label: "Challenges" },
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
  const asked = search.get("show");
  const show: Show = asked === "challenges" ? "challenges" : hasAccounts && asked === "joined" ? "joined" : "all";
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

      <div className="tabbar mb-4 flex w-full sm:inline-flex sm:w-auto" role="group" aria-label="What to show">
        {SHOWS.filter((s) => hasAccounts || !s.accounts).map((s) => (
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

      {show === "all" && hasAccounts && joined.size < CLUBS.size && (
        <p className="mb-4 text-sm text-muted">You can like and reply in the Clubs you’ve joined. Tap a Club’s banner to open it and join.</p>
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

      {signedIn && postable.length > 0 && show !== "challenges" && (
        <div className="mt-2 mb-6">
          <TimelineComposer clubs={postable} />
        </div>
      )}

      {show === "challenges" ? (
        <Challenges now={now} />
      ) : show === "joined" && !signedIn ? (
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
          onAllChallenges={() => setShow("challenges")}
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
