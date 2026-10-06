# ADR 0030: Likes, the Club inbox and the weekly recap

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Extends [ADR 0023](0023-signed-posts-and-lenses.md) (the Board) and [ADR 0022](0022-club-rewards.md) (the Rewards tab). The spec is [09 · Clubs](../09-clubs.md).

## Context

With the Holder pool going to a Club's 10 biggest Holders ([ADR 0029](0029-top-holders-and-posts-only-bonus.md)), most members have no money reason to take part. What brings them back is a response: something happened to what they posted. The Board had none, and the bell only knew about deals.

## Decision

- **Likes.** A member likes a Board post, once, and can take it back. Not their own post, not a hidden one, 120 an hour. A like is attention, not a score: it is **not** in Momentum, the Holder bonus or any reward, because anything that pays can be farmed with free accounts.
- **The Club inbox.** `GET /api/me/club-inbox` derives, from current state, what a signed-in member should hear about their Clubs: likes on their posts from the last 14 days (the key carries the count, so each new like is news again), their pinned posts, and rewards they earned in the latest epochs. Nothing is pushed or stored; the bell merges it with the deal notifications and keeps which keys were seen, as before ([ADR 0003](0003-no-indexer-in-v1.md)'s approach).
- **The weekly recap.** The Rewards tab offers an X compose link with the epoch's fees and what the biggest Holders were paid, and the Club's page as its link. A post that links the Club counts as about the Club ([ADR 0024](0024-x-posts-and-the-holder-bonus.md)), so sharing it can earn the Holder bonus once it's put on the Board.

## What it does not do

- **It doesn't push.** A member who doesn't open the app, or enable browser alerts, hears nothing. Email or push is not built.
- **It doesn't say who liked.** The inbox gives a count, not names, so a like can't be used to pressure or be pressured.
- **It doesn't mark rewards claimed.** The inbox says they were earned; the Rewards and Account screens read claimed state on chain.

## Consequences

- **Two new sets per Club:** `club-likes` (per post) and `club-liked` (per member). Deleting a post, or purging a Club, removes them.
- **A post list read costs one count per shown post** (up to 100) and one set read for the viewer.
- **Posts are always indexed by their author's wallet,** signed or not, so the inbox finds them. The signed-post export still lists only signed ones.
