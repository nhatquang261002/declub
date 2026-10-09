# ADR 0032: Live standings, active days and streaks, and replies

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Amends [ADR 0024](0024-x-posts-and-the-holder-bonus.md) (what the Holder bonus counts) and [ADR 0029](0029-top-holders-and-posts-only-bonus.md) (the bonus numbers); extends [ADR 0030](0030-likes-club-inbox-and-recap.md) (the inbox). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

Club Rewards couldn't be seen until an epoch was built. Nobody knew they were #11, one NFT from being paid, or that one more post would keep their bonus. The bonus counted only a Holder's own X shares, one a day. That is at most 21 of the 50 points for the full bonus, so with reach off nobody could reach +50%. The Board had no conversation either: a post couldn't be answered.

## Decision

- **Live standings.** `GET /api/clubs/[token]/rewards/standings?wallet=` works out the running epoch as if it closed now. It reads the same inputs the builder reads (fees so far, a fresh balance read, active days, streaks) and puts them through the same split. It gives each Holder's rank, bonus and estimated payout, and the reader's own place with `gap`: the NFTs that would get them into the paid places. The answer is cached per Club for 5 minutes and rebuilt by one request at a time. It is labelled an estimate. The Rewards tab shows it as **This epoch · live**: the pool so far, the race with a cut line, and the reader's card with one next step.
- **Active days.** A UTC day in the epoch with at least one visible top-level Board post by the member in that Club. Each is worth `REWARDS.dayPoints` (2), with at most 7 an epoch. Posts are recorded when written, and only the first 3 a day per member. When the epoch is read, a deleted or hidden post counts for nothing.
- **Streaks.** An epoch with at least `streakMinDays` (3) active days keeps a streak going. The streak bonus is `250 × (streak − 1)` basis points, up to `maxStreakBps` (10%), on top of the activity bonus, so the whole bonus is at most 60%. The epoch builder is the only writer of streaks. It builds each epoch once and in order, so a rebuild agrees, and each payout records its `days` and `streak`. Members who aren't Holders keep streaks too, for a badge on the Members list.
- **Retune.** `fullBonusPoints` goes from 50 to 35. A Holder who posts every day (14) and shares an own X post each day (21) earns the full +50% without reach.
- **The bonus still can't buy a place.** Ranking is by shares (`rankHolders`), shared by the split and the standings.
- **Replies.** One level under a top-level post, signed with a separate EIP-712 type `Reply { club, parent, text, at }`, so posts' ids and signatures are unchanged. A reply is stored as a post with `parent`. Likes, reports, hiding, deleting and bans therefore apply to it unchanged. It is not on the Board list or in the lenses, and the feed export carries replies alongside posts. Limits: 50 replies per post, 20 an hour, and a 10-second cooldown. Deleting a post deletes its thread.
- **Replies earn nothing**, like likes ([ADR 0030](0030-likes-club-inbox-and-recap.md)). Only top-level posts make a day active.
- **Nudges.** The Club inbox adds four kinds:
  - `club-reply`: replies from others, a new count being new news;
  - `club-xshare`: your X post counted;
  - `club-rank`: your place, in or out of the paid places, so dropping out is new news;
  - `club-closing`: in the epoch's last day, a reminder to post, or to keep a streak when one more day would.

  The standings are read for at most 5 of a member's Clubs.

## What it does not do

- **It doesn't stop a buy just before the snapshot.** The hold-time rule from ADR 0029 is still not built.
- **An active day can be one short post.** It is capped at one a day and only moves the bonus for the top 10. Spam is still moderated as before: a moderator hides a post, and a hidden post loses its day (reports alone no longer hide one: [ADR 0040](0040-points-floor-held-average-public-backing.md)).
- **It doesn't pay for replies or likes**, so a thread can't be farmed.
- **The estimate can differ from the epoch.** A swap's fee is split between the Clubs its tokens belong to, balances are a few minutes old, and the X reach is read only when the epoch is built.

## Consequences

- **New keys:**
  - `active:{chain}:{club}:{n}`: a set of `userId:day:postId`;
  - `rewards:{chain}:streaks:{club}`;
  - `rewards:{chain}:standings:{club}`: the cache;
  - `rewards:{chain}:fee:{tx}`: a settlement fee read once;
  - `club-replies:{chain}:{club}:{post}`.

  A purge removes all of them.
- **An open Rewards tab, or the bell, can trigger one balance read per Club every 5 minutes.**
- **Copy changed** on the Rewards tab, the Guide and the Clubs intro.
