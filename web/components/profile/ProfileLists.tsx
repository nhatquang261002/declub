"use client";

import Link from "next/link";
import { useState } from "react";
import { getAddress } from "viem";
import { useConnection } from "wagmi";
import { Empty, Loading } from "@/app/clubs/[address]/parts";
import { ClubCard } from "@/components/ClubCard";
import { LoadError } from "@/components/ErrorPanel";
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { ListingGrid } from "@/components/IntentParts";
import { Masonry } from "@/components/Masonry";
import { Pagination } from "@/components/Pagination";
import { TimelineCard } from "@/components/TimelineCard";
import { WalletAvatar } from "@/components/WalletAvatar";
import { Who } from "@/components/Who";
import { useClubs } from "@/hooks/useClubs";
import { useMyClubs } from "@/hooks/useClubMembership";
import { useDealBook } from "@/hooks/useDealBook";
import { useDealsTokenInfo } from "@/hooks/useTokenInfo";
import { useFollowGraph, useWalletBoard, useWalletClubs } from "@/hooks/useWalletProfile";
import { profilePath } from "@/lib/about";
import { toClubInfo, type ClubInfo } from "@/lib/clubs";
import { SHOW_INTENTS } from "@/lib/config";
import { DEFAULT_FILTERS } from "@/lib/dealFilters";
import { estimateHeight } from "@/lib/timeline";
import { registry } from "@/lib/verifiedAssets";

const FOLLOWING_SHOWN = 24;
const DEALS_PAGE = 6;

/**
 * The Clubs whose Members list shows this wallet (ADR 0042), as cards, the ones the Clubs page
 * draws. It is the Club wallet the owner joined with, so a user's other linked wallets list none.
 */
export function ProfileClubs({ address, fresh, now }: { address: string; fresh: boolean; now: number }) {
  const listed = useWalletClubs(address, fresh);
  const summaries = useClubs();
  const mine = new Set(useMyClubs().map((token) => token.toLowerCase()));
  if (listed.error && !listed.data) return <LoadError title="Couldn’t load the Clubs" error={listed.error} />;
  if (listed.isLoading) return <Loading label="Loading Clubs" rows={2} />;
  if (!listed.data?.enabled) return <Empty title="No Clubs here">This server isn’t keeping Club members.</Empty>;
  if (listed.data.clubs.length === 0) return <Empty title="Not in a Club yet">Clubs this wallet joins show here.</Empty>;

  const stats = new Map((summaries.clubs ?? []).map((club) => [club.token, club]));
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {listed.data.clubs.flatMap(({ token }) => {
        const summary = stats.get(token);
        const entry = registry.clubFor(token);
        // Without its numbers (they load apart) a Club is still a card, with a note where they would be.
        const club: ClubInfo | undefined = summary ?? (entry ? toClubInfo(entry) : undefined);
        return club ? [<ClubCard key={token} club={club} stats={summary?.stats} members={summary?.members} now={now} joined={mine.has(token)} />] : [];
      })}
    </div>
  );
}

/** Every Club the app knows, by lowercase token: a post names its Club by token. */
const CLUBS = new Map<string, ClubInfo>(registry.clubs().map((entry) => [entry.address.toLowerCase(), toClubInfo(entry)]));

/**
 * The Board posts a wallet wrote (ADR 0042), as the timeline's cards (ADR 0041): newest first, the
 * next page loading as the end nears. A reader who belongs to a post's Club can like and reply to
 * it here; anyone else reads. Hidden posts are never listed.
 */
export function ProfilePosts({ address, now }: { address: string; now: number }) {
  const feed = useWalletBoard(address);
  const mine = new Set(useMyClubs().map((token) => token.toLowerCase()));
  if (feed.error && feed.posts.length === 0) return <LoadError title="Couldn’t load the posts" error={feed.error} />;
  if (!feed.enabled) return <Empty title="No posts here">This server isn’t keeping Club boards.</Empty>;
  if (feed.isLoading) return <Loading label="Loading posts" rows={2} />;
  if (feed.posts.length === 0) return <Empty title="No posts yet">Posts this wallet makes on a Club’s Board show here.</Empty>;

  return (
    <>
      <Masonry
        as="ul"
        items={feed.posts}
        height={estimateHeight}
        maxColumns={2}
        render={(post) => {
          const club = CLUBS.get(post.club);
          return club ? <TimelineCard key={`${post.club}:${post.id}`} post={post} club={club} joined={mine.has(post.club)} now={now} /> : null;
        }}
      />
      <InfiniteSentinel hasMore={!!feed.hasMore} loading={feed.loadingMore} count={feed.posts.length} failed={feed.loadMoreFailed} onLoadMore={feed.loadMore} />
    </>
  );
}

/**
 * The deals this wallet has open right now, locked and signed (ADR 0020), as the deals page draws
 * them. The reader sees the same actions they would there: accept, or cancel for the maker.
 */
export function ProfileDeals({ address, now }: { address: string; now: number }) {
  const { address: me } = useConnection();
  const [page, setPage] = useState(1);
  const book = useDealBook({
    tab: "open",
    filters: DEFAULT_FILTERS,
    kind: SHOW_INTENTS ? "any" : "locked",
    viewer: me,
    tokens: [],
    maker: getAddress(address),
    page,
    size: DEALS_PAGE,
  });
  const { info } = useDealsTokenInfo(book.items);
  const totalPages = Math.max(1, Math.ceil(book.total / DEALS_PAGE));
  if (book.error && book.items.length === 0) return <LoadError title="Couldn’t load the deals" error={book.error} />;
  if (!book.enabled) return <Empty title="No deals here">Deals aren’t enabled on this deployment yet.</Empty>;
  if (book.isLoading) return <Loading label="Loading deals" rows={2} />;
  if (book.items.length === 0) return <Empty title="No open deals">Deals this wallet has open show here.</Empty>;

  return (
    <>
      <ListingGrid listings={book.items} now={now} me={me} info={info} />
      {book.total > DEALS_PAGE && <Pagination page={page} totalPages={totalPages} onPage={setPage} loading={book.isFetching} />}
    </>
  );
}

/** The wallets this wallet follows (signed follows, ADR 0023), each leading to its own profile. */
export function ProfileFollowing({ address }: { address: string }) {
  const graph = useFollowGraph(address);
  const [all, setAll] = useState(false);
  if (graph.error && graph.following.length === 0) return <LoadError title="Couldn’t load who they follow" error={graph.error} />;
  if (graph.isLoading) return <Loading label="Loading follows" rows={2} />;
  if (graph.following.length === 0) return <Empty title="Not following anyone yet">Wallets they follow show here.</Empty>;

  const list = all ? graph.following : graph.following.slice(0, FOLLOWING_SHOWN);
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((wallet) => (
          <li key={wallet} className="club-panel">
            <Link href={profilePath(wallet)} className="flex items-center gap-3 px-4 py-3">
              <WalletAvatar seed={wallet} size="2.25rem" />
              <span className="min-w-0 flex-1 truncate text-sm">
                <Who address={wallet} plain />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!all && graph.following.length > FOLLOWING_SHOWN && (
        <button type="button" className="btn-secondary mt-4" onClick={() => setAll(true)}>
          Show all {graph.following.length}
        </button>
      )}
    </>
  );
}
