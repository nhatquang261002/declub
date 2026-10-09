# ADR 0034: Swaps count in the Holder bonus, capped

**Status:** Accepted · 2026-10-07 · Web only: no contract change. Amends [ADR 0029](0029-top-holders-and-posts-only-bonus.md) (the bonus counted posts only) and [ADR 0032](0032-live-standings-active-days-and-replies.md) (what the 35 points are made of). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

[ADR 0029](0029-top-holders-and-posts-only-bonus.md) took trading out of the Holder bonus because a member can swap with themselves. But the point of a Club is a market that is busy, and the people who keep it busy should earn from it: a Holder who only posts earns the full bonus, one who also trades earns nothing more.

The owner of the project chose to count swaps again, by swap count as Momentum does, knowing that it reopens the wash-trading route ADR 0029 closed. This ADR says how far it opens.

## Decision

- **A completed swap earns `REWARDS.swapPoints` (2)** for a member when someone other than their own linked wallets is on it. A swap between a member's own wallets earns nothing.
- **A repeat counterparty counts half** (`MOMENTUM.washFactor`): swapping again, in the same epoch, with a wallet the member already swapped with within `MOMENTUM.washDays` (7) counts 1 point. The same rule Momentum uses.
- **At most `REWARDS.swapCapPerEpoch` (14) points an epoch** per member per Club, so a Holder who trades and never posts gets at most 14 of the 35 points: **+20%** (`bonusBps(14)`). This cap is new: Momentum has none, and a bonus with none would let volume buy all of it.
- **Same bonus, same cap.** Swap points add to active days and X shares inside the one `fullBonusPoints` (35) and `maxBonusBps` (50%) ceiling. They don't change who is among the paid 10 (ranking is still by shares), and `fullBonusPoints` stays.
- **Only the epoch's own swaps** are read, so the wash rule sees swaps inside the epoch only: a counterparty from the previous week counts in full.
- **Reads the same activity events** the fees do (`swapped` events in the epoch window), so live standings and the builder agree. `Activity` gains a `swaps` field.

## What it does not do

- **It doesn't make wash trading impossible.** A Holder can swap with a second wallet they don't link. Each swap pays the whole fee for every NFT each side gives, and at most 75% of it comes back, shared with the other Holders. The gain is at most +20% of one Holder's share of the Holder pool, so a wash loop costs more in fees than the bonus returns unless the pool is large relative to the fees paid. That is the bet; if it's wrong, lower `swapCapPerEpoch` or `swapPoints` (one line each in `REWARDS`).
- **It doesn't count distinct counterparties across epochs,** only inside one.
- **It doesn't weigh by fee.** A one-NFT swap earns the same as a five-NFT swap.

## Consequences

- The Rewards tab, the Guide, the user guide and the specs no longer say trading earns nothing; they say what it does earn.
- Tests: swaps with others count, own wallets don't, a repeat is halved, the cap holds against 40 swaps with one partner and with 40 partners, and the epoch builder applies it.

## Alternatives considered

- **Gate the bonus on trading at all** (a Holder gets it only with one swap). One self-trade unlocks it: the worst of the options.
- **Points by distinct counterparty, paid by fees.** Harder to fake, and what I'd choose first; not chosen here. It is a small change in `swapActivity` if the cap proves too loose.
