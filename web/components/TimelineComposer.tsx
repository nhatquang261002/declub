"use client";

import Link from "next/link";
import { useState } from "react";
import { PostComposer } from "@/components/PostComposer";
import { Select } from "@/components/Select";
import { useClubPage } from "@/hooks/useClubBoard";
import { useClubMembership } from "@/hooks/useClubMembership";
import type { ClubInfo } from "@/lib/clubs";
import { isStaff } from "@/lib/clubRoles";

/**
 * Post from the timeline: pick which of your Clubs it goes to, then write it. The post is the
 * Board's own (signed by your Club wallet in that Club, counted and moderated there), so it shows
 * up in the list as soon as it is sent. `clubs` are the ones you can post in: joined, not archived.
 * A Club that has limited posting to Holders says so here instead of showing a box that would be refused.
 */
export function TimelineComposer({ clubs }: { clubs: ClubInfo[] }) {
  const [picked, setPicked] = useState<string>();
  const club = clubs.find((c) => c.token === picked) ?? clubs[0]!;
  const me = useClubMembership(club.token);
  const page = useClubPage(club.token);
  const holdersOnly = page?.holdersOnlyPosts === true && me.member && !me.holder && !(me.role && isStaff(me.role));

  const picker = (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-bold">Post in</span>
      {clubs.length > 1 ? (
        <Select
          value={club.token}
          options={clubs.map((c) => ({ value: c.token, label: c.name }))}
          onChange={setPicked}
          aria-label="Club to post in"
          className="w-52"
        />
      ) : (
        <span className="chip chip-peach py-1">{club.name}</span>
      )}
    </div>
  );

  return (
    <div>
      {holdersOnly ? (
        <div className="club-panel mb-5 p-5">
          <div className="mb-3 flex justify-end">{picker}</div>
          <p className="font-extrabold">Only Holders post in {club.name}</p>
          <p className="mt-0.5 text-sm text-muted">This Club’s Owner has limited posting to members who hold {club.symbol}. You can still read, like and reply to others.</p>
        </div>
      ) : (
        // Keyed by Club: a draft belongs to the Club it was written for, and each Club has its own wallet for you.
        <PostComposer key={club.token} token={club.token} wallet={me.wallet} xHint={page?.x?.hint} picker={picker} />
      )}
      <p className="-mt-2 mb-5 text-xs text-muted">
        Posting needs a linked X or Discord account with “Show my X or Discord handle” turned on in your{" "}
        <Link href="/profile" className="font-bold underline">
          Profile
        </Link>
        .
      </p>
    </div>
  );
}
