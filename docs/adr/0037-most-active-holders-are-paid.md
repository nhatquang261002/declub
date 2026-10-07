# ADR 0037: The most active Holders are paid, not the biggest

**Status:** Accepted · 2026-10-07 · Web only: no contract change. Amends [ADR 0029](0029-top-holders-and-posts-only-bonus.md) (who is among the paid 10) and the "ranking is by shares" lines of [ADR 0032](0032-live-standings-active-days-and-replies.md) and [ADR 0034](0034-swaps-count-in-the-holder-bonus.md). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

The Holder pool went to a Club's 10 biggest Holders by NFT count, and activity only changed the split among them. The bag decided who was paid, so a quiet whale was paid every week and an active small Holder never was. The point of Club Rewards is that taking part turns into a stake, so who is paid has to follow taking part.

## Decision

- **Holding is the gate, activity is the rank.** A member must hold at least one NFT of the collection (summed over their linked wallets, read when the epoch is built). Among those, the `REWARDS.maxHolders` (10) with the most activity points in the epoch are paid.
- **No points, no payout.** A Holder with zero points is ranked but never paid (`paidPlaces`). With fewer than 10 active Holders, only they are paid.
- **The split among the paid doesn't change:** shares × (1 + bonus), one share per NFT, so holding stays the base weight and activity still adds up to +50% and a streak up to +10%.
- **Ties** go to the bigger holding, then the earlier member, then the lower wallet, so a rebuild gives the same tree (`rankHolders`).
- **Live standings and the bell** now say how many more activity points get a Holder in (`entryGap`), not how many more NFTs; a Holder with no points sees "not paid yet".
- **Unchanged:** the 50/25/25 split, sponsored epochs, the carry, joined members only, and the point rules of ADRs 0024, 0032 and 0034.

## What it does not do

- **It doesn't stop a sole active Holder taking the whole pool.** In a quiet Club, one Holder with a single post is the only one paid and gets all of it. The fees are small there, and a sponsor's money would go to the same person. A minimum number of points, or a cap per Holder, is the fix and is not built.
- **It makes points worth more, so swap and post farming pay more than before.** Swap points are still capped at 14 of the 35, and own-wallet swaps and repeat counterparties earn little, but a place is now won by points, not only a bigger bonus.
- **It doesn't snapshot holding over the epoch.** A Holder who buys one NFT near the end and posts still ranks. The hold-time rule is still deferred.

## Consequences

- **Fewer than 10 payees is normal** in a quiet Club, and the rest of the pool is shared among them, not carried.
- **A Club with Holders but no activity carries its pool**, like a Club with no Holders.
- **Copy changed** on the Rewards tab, the Guide, the home page, the Clubs intro, the Sponsor dialog and the weekly recap ("most active Holders").
- **Test fixtures** for the split, standings, inbox and builder now give Holders activity points.
