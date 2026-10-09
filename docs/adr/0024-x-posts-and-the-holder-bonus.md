# ADR 0024: X posts, Momentum and the Holder bonus

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Amended by [ADR 0029](0029-top-holders-and-posts-only-bonus.md) (posts only, no trading) and [ADR 0032](0032-live-standings-active-days-and-replies.md) (35 points, active days, streaks). Amends [ADR 0016](0016-clubs-and-momentum.md) (posts weighed nothing) and [ADR 0022](0022-club-rewards.md) (rewards followed holdings only). The spec is [09 · Clubs](../09-clubs.md#x-posts).

## Context

A Club's attention happens on X, not on its Board. Until now the app ignored it: a Board post could only link a deal or a signed swap, Momentum counted only trading, and the Holder pool paid purely by holdings. For a community to own its attention, the members who bring a Club attention should be seen and paid for it, without opening a farm.

Constraints:

- **Posting is free, so counting posts invites fakes.** Holdings-based pay is safe because splitting NFTs across accounts earns nothing; pay per account's posts is not.
- **The X API costs money** (pay per use, about $0.005 a post read in 2026). What the free oEmbed endpoint gives (a public post's author and text) costs nothing.
- **Nothing on chain changes.** `DeClubRewards` and its leaf stay as they are.

## Decision

**Members can share X posts on the Board. A Holder's own X post about the Club counts toward their Momentum and toward a bonus on their Holder share. Counting needs nothing paid; with the X API configured, engagement adds to it once per epoch.**

- **Sharing:** a *note* may carry one X post link (`https://x.com/i/status/<id>` is the canonical, signed form; a *Looking for* post keeps deal and signed-swap links). The server reads it through oEmbed and stores a card (author, text, time from the post id). Any public X post can be shared; it is shown, not counted, unless it qualifies.
- **What counts (an X share):** the post is by the member's own X account (Privy's verified link), they hold the Club's asset, it is at most 48 hours old, it is about the Club, it has never counted before, and it is their first in this Club today. Hiding the Board post stops it counting; deleting it ends it.
- **About the Club, by the Club's signals:**
  - *strong*: it names the Club's token address or links its Club page, or mentions, quotes or replies to the project's X account;
  - *weak* (counts half): it only matches a tag (`$SYMBOL`, always on, plus up to 10 hashtags, cashtags or words the Owner sets);
  - matching is yes or no per post, so stuffing tags gains nothing.
- **The project's X account is linked by proof:** the Owner names a handle, gets a one-time code, posts it from that account, and pastes the link; the server checks author and code through oEmbed. Up to three per Club. A typed handle alone is never trusted.
- **Momentum:** an X share is an `xshare` event worth `MOMENTUM.xShareWeight` (3, half for weak) to its member's Club wallet. It doesn't widen the Club's breadth or its traders count.
- **The Holder bonus:** a Holder's weight in the pool is `shares × (1 + bonus)`, bonus 0 to +50% from their activity in the Club that epoch, with no decay:
  - trading, as Momentum weighs it;
  - X shares: `xShareBase` (3) each, halved when weak;
  - with the X API, `reachWeight × log2(1 + engagement)` more per share, capped at 30 a member per epoch;
  - 50 points earn the whole bonus. Without reach, a week of daily X shares gives at most 21, so posting alone reaches about +21% and trading makes up the rest.
- **Two modes, chosen by `X_BEARER_TOKEN` where the epoch is built:**
  - *Counting only* (no token, the default): every counted X share adds the same. Nothing is read again at the epoch, so a post deleted on X after it was shared still counts; hiding or deleting the Board post still stops it. Quotes and replies of the project account, and Club links behind X's shortened `t.co` links, aren't seen (a plain @-mention is).
  - *With reach* (token set; built, off until `X_BEARER_TOKEN` is set): before the epoch is built (`lib/server/xReach.ts`, run by `npm run rewards:epoch`), every X share is read from the X API. Engagement is likes + reposts + quotes + replies (impressions are too easy to inflate). Each share is checked again: the author by X's numeric id, which a rename can't fake, and the signals with full links and quoted authors. A deleted post, or one edited so it's no longer about the Club, counts nothing. The read is saved and published with the epoch.

## What it does not do

- **It doesn't pay for posting by itself.** Holding is still the base; the bonus multiplies it. A member with nothing staked earns nothing, however loud.
- **It doesn't judge quality.** Engagement stands in for it, on a log scale and capped. Bought likes still move it a little; the cap bounds by how much.
- **It doesn't trust the post's text for identity.** Only Privy's verified link says whose account it is, and at the epoch, X's numeric id.
- **It doesn't make X data permanent.** A card is a copy taken when the post was shared; X is the source.

## Consequences

- **Splitting holdings across accounts still gains nothing:** the bonus scales with shares, so one account with two NFTs and a bonus earns what two accounts with one NFT each and the same bonus do (but for rounding).
- **No running cost by default.** With reach on: at most one counted X share per member per Club per day, each read once: about $5 per 1,000.
- **New store keys:** `declub:xshares:{chain}:{club}` (ranked) and one record per share, a once-ever marker per X post, a pending proof code per handle, and `declub:rewards:{chain}:reach:{n}`.
- **The epoch record grows:** each holder payout carries its `shares`, `bonusBps` and `points`, and the record carries the reach read, so anyone can recompute the bonus.
- **Copy changed:** the "Top traders" lens and list are now "Most active", Momentum's explainer mentions X posts, and the Club page shows "X posts · 7 days" and the linked project accounts.
