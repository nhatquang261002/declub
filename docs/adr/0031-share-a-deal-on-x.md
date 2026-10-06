# ADR 0031: Share a deal on X

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Builds on [ADR 0024](0024-x-posts-and-the-holder-bonus.md) (a post about a Club counts once it's on the Board) and [ADR 0030](0030-likes-club-inbox-and-recap.md) (the recap link).

## Context

A deal link pasted into X showed as a bare URL: the deal page is a client screen that reads the chain in the browser, so crawlers saw nothing about the offer. And nothing in the app offered to post a deal or a swap.

## Decision

- **A preview card.** `app/v2/deal/[id]/layout.tsx` sets the title and description from a server read of the deal (`lib/server/dealCard.ts`), and `opengraph-image.tsx` draws a 1200×630 card: the status, what the maker gives, what they ask (or "Open to offers"). It is read per request, so a filled deal shows as swapped. A deal that can't be read, or no escrow on the deploy, falls back to the site's default.
- **A share button.** The deal page offers **Share on X** for a live offer and **Share the swap on X** for one that went through, to anyone. It opens an X compose link (`lib/dealShare.ts`): text such as "Offering Chog #12 for 3 MON in the Chog Club. Take it:", and the deal's page as the link. A deal creation lands on this page, so the maker sees it right after.
- **About the Club.** When an asset in the deal belongs to a Club, the text names it, and the page tells the member to paste the post on that Club's Board, where their own post about the Club counts toward the Holder bonus ([ADR 0024](0024-x-posts-and-the-holder-bonus.md)).
- **`NEXT_PUBLIC_SITE_URL`** sets the absolute base for the card's image URL (else Vercel's production host, else localhost).

## What it does not do

- **It doesn't post for anyone.** The compose link only opens X; the member sends it.
- **It doesn't count the share by itself.** It becomes a counted X share only when the member shares the post on the Board.
- **It doesn't draw NFT art.** The card is text; showing the NFT images is a follow-up.
- **It doesn't cache the card.** Each crawl reads the chain once.
