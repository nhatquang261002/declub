# ADR 0043: System messages in the Board and the timeline

**Status:** Accepted · 2026-10-07 · Web only: no contract change and no new records. Fulfils the roadmap's "Club Pulse". The spec is [09 · Clubs](../09-clubs.md).

## Context

A Club's Board shows only what members wrote, and the timeline ([ADR 0041](0041-timeline.md)) shows only those posts. A Club can be busy (swaps, new deals, new members) with no one posting, and then both read as dead. The activity is already known: the log behind Momentum ([ADR 0016](0016-clubs-and-momentum.md)) and the member list. The first cut was a strip of counts under the Club header; it was dropped for messages in the feeds themselves, which is where people already look.

## Decision

A **system message** is one line, set among the posts by time:

| Kind | Colour | Icon | Reads |
|---|---|---|---|
| Swap | green | swap arrows | "A and B swapped", with a link to the deal, or for a signed swap its transaction |
| Listing | blue | tag | "A listed a deal", with a link to it |
| Join | orange | people | "A joined the Club" |

On the Board a message is a row of the list with a coloured edge. On the timeline it is a small card that names the Club it came from. Names open profiles ([ADR 0042](0042-profile-page.md)) as everywhere. There is no author, no like, no reply and no menu: nobody wrote it.

- **Where.** The Board shows them when it is ordered newest first and shows all posts (another lens, or "Looking for", is a question about posts). The timeline shows them in both sections. Pinned posts stay on top.
- **What counts.** Completed swaps and new deals from the Club's activity events, and members by `joinedAt`, over the last 7 days. X shares are not messages: they are posts already.
- **Nothing is stored.** `GET /api/clubs/[token]/system` and `GET /api/timeline/system?scope=` read the log and member rows when asked, take the newest 40, and return them with `since`: the moment from which the list is complete (the window's start, or where the 40 were cut). Cached like the Boards: 15 seconds for anonymous readers, private for a signed-in one. The timeline's `scope` picks Clubs the same way the timeline does (`timelineClubs`), so `joined` is the caller's own.
- **Paging.** The timeline loads posts a page at a time, and messages come in one list. A message older than the oldest post loaded is held back until the posts reach it (and one older than `since` is never drawn), so a message never jumps ahead of posts that have not loaded, and a quiet gap is never drawn where the list was only cut. The feeds are woven by `weave` in `lib/systemFeed.ts`.

## What it does not do

- **It doesn't count or rank.** There are no tallies ("5 swaps today"): each event is its own line.
- **It isn't a notification.** It doesn't badge, toast or reach the inbox; it is in the feed when someone looks.
- **It doesn't reach back past a week**, or past the 40 newest in a busy Club or timeline: older posts show without messages.
- **It doesn't show swaps' contents.** What was swapped lives on the deal's page, which the line links to.
- **A join shows the Members list's own wallet.** Anyone's membership is already public there ([ADR 0016](0016-clubs-and-momentum.md)); the message adds a time, not a new fact.
