# ADR 0043: System messages on the Board

**Status:** Accepted · 2026-10-07 · Web only: no contract change and no new records. Fulfils the roadmap's "Club Pulse". The spec is [09 · Clubs](../09-clubs.md).

## Context

A Club's Board shows only what members wrote. A Club can be busy (swaps, new deals, new members) with no one posting, and then its Board reads as dead. The activity is already known: the log behind Momentum ([ADR 0016](0016-clubs-and-momentum.md)) and the member list. The first cut was a strip of counts under the Club header; it was dropped for messages in the feeds themselves, which is where people already look.

## Decision

A **system message** is one quiet line, set among the posts by time. Its kind shows in a small coloured icon; the rest of the line stays grey, so the posts remain what the eye goes to:

| Kind | Icon colour | Icon | Reads |
|---|---|---|---|
| Swap | green | swap arrows | "A ⇄ B **swapped**": the verb opens the deal, or a signed swap's transaction |
| Listing | blue | tag | "A **listed a deal**", opening it |
| Join | orange | people | "A joined" |

Names are the shown handle or the short address, with no copy button, so a line fits on one row (it is cut with an ellipsis if not). The messages between two posts are **one group**: the first three lines and "+N more". A busy stretch reads as one block, not a wall.

A group is a row of the Board's list. Names open profiles ([ADR 0042](0042-profile-page.md)) as everywhere. There is no author, no like, no reply and no menu: nobody wrote it.

- **Where.** Only on the Board, when it is ordered newest first and shows all posts (another lens, or "Looking for", is a question about posts). Pinned posts stay on top. Not on the timeline ([ADR 0041](0041-timeline.md)): across many Clubs they crowded out the posts, which are what the timeline is for.
- **What counts.** Completed swaps and new deals from the Club's activity events, and members by `joinedAt`, over the last 7 days. X shares are not messages: they are posts already.
- **Nothing is stored.** `GET /api/clubs/[token]/system` reads the log and member rows when asked, takes the newest 40, and returns them with `since`: the moment from which the list is complete (the window's start, or where the 40 were cut). Cached like the Board, for 15 seconds.
- **Paging.** The Board loads posts a page at a time, and messages come in one list. A message older than the oldest post loaded is held back until the posts reach it (and one older than `since` is never drawn), so a message never jumps ahead of posts that have not loaded, and a quiet gap is never drawn where the list was only cut. The Board is woven by `weave` in `lib/systemFeed.ts`.

## What it does not do

- **It doesn't count or rank.** There are no tallies ("5 swaps today"): each event is its own line.
- **It isn't a notification.** It doesn't badge, toast or reach the inbox; it is in the feed when someone looks.
- **It doesn't reach back past a week**, or past the 40 newest in a busy Club: older posts show without messages.
- **It doesn't show swaps' contents.** What was swapped lives on the deal's page, which the line links to.
- **A join shows the Members list's own wallet.** Anyone's membership is already public there ([ADR 0016](0016-clubs-and-momentum.md)); the message adds a time, not a new fact.
