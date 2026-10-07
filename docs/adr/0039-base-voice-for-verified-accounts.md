# ADR 0039: Verified accounts get a small base voice, across every Club

**Status:** Accepted · 2026-10-07 · Web only: no contract change. Amends "only Holders' voice counts" in [ADR 0038](0038-points-from-backing.md). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

ADR 0038 gave a voice only to a Club's Holders, so likes and replies from anyone else counted for their own active day and nothing more. An explorer tab that shows every Club's Board as one timeline is planned: people from other communities will read and answer there, and that engagement should count for something. But points decide who is paid, and a linked X or Discord account costs nothing, so outside voices must not be able to decide the race.

## Decision

Everyone who engages has up to two voices a week:

- **NFT voice, in their own Club only (unchanged):** a Holder's 10 points per NFT, counting up to 5, shared over what they gave in that Club. NFTs speak for the community they belong to.
- **Base voice, broadcast:** every verified account, Holder or not, has `baseVoice` (3) a week. It is shared over the likes and replies they gave in **every** Club that epoch, so engaging with twenty Boards spreads the same 3 points thin. A Holder's base voice adds to their NFT voice.

Guards:

- **Verified** means a shared X or Discord profile (ADR 0011) first shared at least `verifiedDays` (7) before the epoch ends. The profile row now keeps `since`, the first time it was shared, across rewrites; dropping the share and sharing again starts the clock again. Rows written before `since` existed use their `updatedAt`.
- **A cap per receiver:** at most `baseCapPerReceiver` (10) of a member's points an epoch come from base voices. Outsiders can lift a member; the Club's Holders still decide who is paid.
- **Mutual backing** counts half between any two members who both have a voice, base or NFT. A like back from someone with no voice still trades nothing.
- Everything else from ADR 0038 stands: weights, no self-backing, takebacks and hidden posts count for nothing.

## Recorded

Each like and reply is also indexed per user and epoch across Clubs (`declub:backing-by:{chain}:{n}:{userId}`, `club|kind|day|postId`). `givenEverywhere` reads it, checking each entry still stands in its Club, to share a base voice. `voicesFor` gives each giver their NFT voice and base voice for a Club; `backingPoints` applies them and reports how much came from base voices (`basePoints` in the standings).

## What it does not do

- **It doesn't let outsiders be paid.** They hold nothing in the Club, so they aren't ranked. Their engagement earns them active days and, later, a cross-Club record on the explorer.
- **It doesn't check X account age or followers.** Only how long the profile has been shared on DeClub. Reading X needs `X_BEARER_TOKEN`; it can be added to the verified check later.
- **It doesn't build the explorer.** Engaging still needs joining the Club; the explorer will join on the first like or reply.

## Consequences

- A Holder's like in their own Club now carries their NFT voice plus a share of their base voice.
- With the cap, 10 points from outside are worth at most 10 of the 35 that earn the full bonus, and can't outweigh one 1-NFT Holder's full backing.
- Copy changed on the Rewards tab, the Guide, the README and docs 07, 09, 11 and 13.
