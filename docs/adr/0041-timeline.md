# ADR 0041: A timeline of Board posts across Clubs

**Status:** Accepted · 2026-10-07 · Web only: no contract change and no new records. Fulfils the timeline that [ADR 0039](0039-base-voice-for-verified-accounts.md) and [the 0040 plan](../plans/0040-hard-to-game-points.md) said would come. The spec is [09 · Clubs](../09-clubs.md#screens). **Amended 2026-10-07:** the "Around the other Clubs" section is removed from the page; the timeline is the reader's own Clubs only, with their system messages ([ADR 0043](0043-system-messages.md)). The API's `scope=others` is kept but no longer used by the page.

## Context

A Club's Board is only read by people who open that Club. Someone in three Clubs has to visit three pages to see what was said, and someone in none has nowhere to see that Clubs are alive. ADR 0039 expected "an explorer tab that shows every Club's Board as one timeline", where people from other communities read and answer; the 0040 plan shaped backing, reports and moderation to stay keyed by a post's Club so that page would need no rework.

## Decision

A page, `/timeline`, in the header, with two sections:

- **From your Clubs:** posts from the Clubs the reader belongs to, newest first, in a masonry of one, two or three columns by screen width (each post goes under the shortest column, by an estimated height, so there are no gaps and loading more moves nothing). The reader can like, reply and report here. These call the Board's own routes with the post's Club, so a like, reply or report lands exactly as it would on the Club page: backing, active days, the Moderators' "Reported" list and the rules of ADRs 0038 to 0040 are unchanged.
- **Around the other Clubs:** posts from every other live Club, newest first, in the same masonry. Archived Clubs are left out (a frozen Board has nothing new); a reader's own archived Club still shows under their Clubs. For a Club the reader hasn't joined the card is read-only and says "Join to like and reply", linking to that Club's Board. Joining is still the Club page's one deliberate step.

Both lists are endless: the next page loads as the end of the list nears, with no "show more" button and no cap short of the Boards' own. A post is drawn as a card, not a Board row: a cover in its Club's colours with its name (opening the Board), the author, the text set larger (a short post with nothing attached is set as a quote), its X card or deal link, and the like, reply and report actions. Moderation (hide, pin, ban, delete) is not offered here: it stays on the Board, where the Club's tools and context are.

`GET /api/timeline?scope=joined|others&limit=&before=` merges the Clubs' Boards and pages by cursor. `before` is the post the last page ended on (the `next` the last page returned), so a page is everything after it, newest first, and the list goes back as far as the Boards do (each keeps its newest 500 posts) with nothing capped. Each page reads the next slice of every Club's ranking (`rankedBefore`, a store read by score), a little more than a page per Club; a Club whose slice was full may hold older posts than it returned, so anything older than that edge waits for the next page, which keeps the merged order exact. A page costs a few store reads per Club however far down it is, and nothing is read before the reader scrolls to it. New posts don't shift what has loaded: they come with the first page. Which Clubs are "joined" is decided by the server from the caller's token; a `scope` only names the section. Hidden posts and replies are never listed, to anyone (the author and Moderators see them on the Board), and pins are ignored: a pin is a Club speaking on its own Board.

## What it does not do

- **It doesn't auto-join.** A first like or reply from the timeline could join the reader, and the 0040 plan notes the held-NFT average would cope. It is left for later because joining puts a wallet on a public Members list, and that should be a click the reader meant.
- **It doesn't rank.** Newest first, with no Momentum or "for you" ordering. Each Club's recent posts are capped so a busy Club can't fill the page, but nothing else mixes them.
- **It doesn't keep a feed.** There is no timeline record to fall out of date: it is read from the Boards on request and cached for 15 seconds for anonymous readers.
- **It doesn't show replies.** They open under their post, one level deep, as on the Board.
