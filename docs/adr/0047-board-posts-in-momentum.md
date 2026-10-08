# ADR 0047: Holders' Board posts count toward Momentum

**Status:** Accepted · 2026-10-08 · Web only: no contract change. Changes the "any other Board post: 0" row of [ADR 0016](0016-clubs-and-momentum.md) and sits beside the X shares of [ADR 0024](0024-x-posts-and-the-holder-bonus.md). The spec is [09 · Clubs](../09-clubs.md#momentum).

## Context

Momentum counted swaps, new deals and Holders' X shares. A Club whose Holders talk on its Board every day scored the same as one with a silent Board, so the score missed the part of a Club's life that happens in the app. The user wants Board posts to count, a little more than an X share.

Board posts are free to write, so counting every one would let a member post their way up the Clubs page.

## Decision

A new Momentum event, **`post`**, worth `MOMENTUM.postWeight` (4, against an X share's 3) to its author's Club wallet:

- **Holders only,** as with X shares: a free wallet that joins can't add to it. The Holder flag is read when the post is written.
- **The first post of the UTC day per member per Club.** A post sharing an X post is still a Board post, so a Holder's first post of the day can count as both.
- **Top-level posts only.** Replies count for nothing here (they already count toward Rewards).
- **Hidden or deleted posts count for nothing.** Each post is recorded when it's written (`recordMomentumPost`, up to 3 a member a day, at `declub:momentum-posts:{chain}:{club}`). Reading (`momentumPostEvents`) checks the post is still there and not hidden, and takes the member's first such post that day. A moderator's hide or a deletion removes it, and the member's next post that day takes its place.
- **Attention, not trading:** like an X share, it adds to the member's Momentum and leaves breadth and "Traders · 30 days" alone.

## Consequences

- An active Holder adds up to 4 a day before decay; with an X share the same day, 7. A swap stays the biggest single event (10 a side, and it widens breadth).
- `ClubStats.posts7d` counts the posts that counted. The Club page's "X posts · 7 days" stat becomes "Posts · 7 days", with the X posts under it.
- Club Rewards is unchanged: it counts posts through active days and backing, not through Momentum events.
- One more read per Club per Momentum computation: the ids, then the posts in one `getMany`, capped at 5,000.
