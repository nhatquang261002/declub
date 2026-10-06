# ADR 0029: Top Holders get paid, and the bonus counts posts only

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Amends [ADR 0022](0022-club-rewards.md) (who shares the Holder pool) and [ADR 0024](0024-x-posts-and-the-holder-bonus.md) (what the Holder bonus counts). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

Every joined Holder shared the Holder pool. In a big Club that means hundreds of tiny payouts, each one a leaf to prove and a claim that may cost more gas than it pays. The bonus also counted a Holder's own swaps, and a member can swap with themselves to earn it.

## Decision

- **Only the `REWARDS.maxHolders` (10) biggest Holders by shares are paid.** The pool is split among them by shares × (1 + bonus). A tie at the cutoff goes to the earlier member (`joinedAt`), then the lower wallet, so a rebuild gives the same tree. The bonus changes the split, never who is in.
- **The bonus counts a Holder's own X posts only.** Trading earns no points. `activityPoints` no longer reads swaps.
- **Unchanged:** the 50/25/25 split, one share per NFT, joined members only, and the carry: a Club with no Holders keeps its pool.

## What it does not do

- **It doesn't stop a buy just before the snapshot.** Shares are one read when the epoch is built. A hold-time rule (the lowest balance across the epoch) is the fix and is not built yet.
- **It doesn't pay small Holders.** They keep the badge, Momentum and the Board, not a share of the fees.
- **It doesn't bring the bonus to full without reach.** X posts alone give about +21% a week.

## Consequences

- **At most 10 Holder leaves per Club per epoch,** plus the Owner's, so claims stay few.
- **`holderCount` in an epoch** is now the number paid (at most 10).
- **Copy changed** on the Rewards tab, the Guide, the home page and the Clubs intro.
