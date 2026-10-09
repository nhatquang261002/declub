# ADR 0048: A challenge entry earns through its challenge, not the epoch

**Status:** Accepted · 2026-10-08 · Web only: no contract change. Amends [ADR 0045](0045-club-challenges.md) (challenges), and how [ADR 0032](0032-live-standings-active-days-and-replies.md) (active days), [ADR 0024](0024-x-posts-and-the-holder-bonus.md) (X shares) and [ADR 0038](0038-points-from-backing.md) (backing) treat one kind of post. [ADR 0047](0047-board-posts-in-momentum.md) (Momentum) is unchanged. The spec is [09 · Clubs](../09-clubs.md#challenges).

## Context

A challenge entry is an ordinary Board post that shares the member's own X post. So far it earned whatever any such post earns, before the challenge paid anything: an active day, an X share if it passed the X-share rules, and backing from every like and reply on it. In a likes-judged challenge the same likes then decided the prize, so they paid twice. And an entry that lost still earned, which makes a challenge a way to farm epoch points with posts written for it.

A challenge's prize is what the Owner chose to pay for its entries, in points now and possibly in assets later. It should be the whole of what an entry earns.

## Decision

- **An entered post is covered by its challenge.** When it is entered, the post is marked with the challenge (`StoredPost.entry`), and so is its X share if it counted (`XShare.entry`). The challenge keeps every post it covered (`declub:challenge:{chain}:{club}:entered:{id}`).
- **It still counts toward Momentum.** It is a Board post on the Club's Board, so a Holder's first post of the day and its X share move Momentum as before (`momentumPostEvents`, `xShareEvents`). Momentum measures the Club's activity, not anyone's pay.
- **It earns its author no epoch points of its own:**
  - **No active day:** `activeDays` skips it. A like or reply the member gives that day, or another post, still makes the day active.
  - **No X-share points:** `activityPoints` skips an X share event marked `entry`, and the standings don't count it. Entering gives back the day's X-share slot (`setXShareEntry` clears the day's count), so the member's next X post that day can still count.
  - **No backing:** likes on the entry, and replies to it, are marked `entry` (`BackingAction.entry`). `backingPoints` leaves them out, and they don't spend the giver's voice (`givenEverywhere` skips them too). They are published with the flag, so the backing can still be recomputed.
- **Whoever likes or replies still engages.** `engagementPoints` counts entry actions like any other, so liking entries earns the giver what engaging with that member earns (ADR 0046, capped at 5 an epoch), and it makes their day active.
- **The mark stays after a withdrawal or replacement.** Otherwise a member could enter a post, collect backing while it ran, then take it back to keep that backing. A post that was entered earns through its challenge, whether or not it stayed in.
- **A cancelled challenge gives its posts back.** `cancelChallenge` clears the mark on every post it covered, since nothing will pay for them. They then earn like any post, in epochs not yet frozen.
- **A post from a frozen epoch can't be entered** (`bad_post`). It already earned there, and its prize would pay for it twice.

## Consequences

- An entry that loses earns its author nothing. A likes-judged challenge pays its winners once (the prize), not twice.
- Entering costs a member the backing their post would have drawn. A challenge only gets entries if its prize is worth more, which is the Owner's call.
- The X share an entry used no longer blocks the member's next X post that day. Momentum can count both, as it would count any two Board posts.
- Frozen epochs never change. An epoch frozen while a post is entered, before the challenge is cancelled, keeps it out.
- Old posts and shares have no mark and read as before. Nothing is migrated.
