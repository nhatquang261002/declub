# ADR 0025: Clubs are for NFT collections; a memecoin joins one

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Amends [ADR 0016](0016-clubs-and-momentum.md) (a Club per verified collection or memecoin) and [ADR 0022](0022-club-rewards.md) (shares from the NFT and the coin). The spec is [09 · Clubs](../09-clubs.md#which-assets-get-a-club).

## Context

Club Rewards pay Holders out of the fees their Club's swaps pay ([ADR 0022](0022-club-rewards.md)). That fits NFTs and fits memecoins badly:

- **A memecoin Club's fee pool is close to empty.** The fee is a flat $2 a side ([ADR 0015](0015-protocol-fee.md)). NFTs have no AMM, so OTC is where they trade; a memecoin trades on DEXes and bonding curves for cents, and almost nobody pays $4 to swap one here. The split can be fair and still pay nothing.
- **One snapshot is easy to game on a liquid token.** Holdings are read once, when the epoch is built. NFTs change hands slowly; a memecoin can be bought before the build and sold after it, and a long holder who sold the day before gets nothing.
- **Shares in a paired Club mixed units.** One share per NFT plus one per `minHolding` (or whole token) of the coin: with a billion-token supply, coin holders swamped NFT holders. Tuning `minHolding` to fix that would also raise the Holder badge bar, which it sets too.

## Decision

**Only an NFT collection has a Club. A memecoin can join its collection's Club, and Club Rewards follow the collection's NFTs only.**

- **No memecoin Club of its own.** In `web/data/assets.json` a memecoin's `club` must be its collection's address, or `false`. Leaving it out, `true` or `"archived"` fails the build. A collection can't join another Club. The archive setting is the collection's, for both.
- **Holding the coin makes a Holder,** as before: at least `minHolding` (any balance without one) earns the badge, the Board voice that comes with it, and counted X shares toward Momentum. ([ADR 0026](0026-owner-sets-the-coin-holder-rule.md) lets the Owner switch this off or set the minimum.)
- **Shares are one per NFT of the collection,** summed over a member's linked wallets. A member who holds only the coin has no shares, so no Holder payout and no bonus (the bonus multiplies shares). `minHolding` is the badge threshold and nothing else.
- **Fees from the coin's swaps still count.** A swap naming the coin is logged to its Club as before, so its fee goes to the collection's Holders and the Club fund.
- **The Clubs list filters by "With a memecoin"** instead of Collections and Memecoins, since every Club is a collection's.

## What it does not do

- **It doesn't pay coin holders.** A collection's community decides whether its coin matters; if a project wants to reward its coin holders, that's for a later decision (a fixed slice of the pool, or the project funding its own).
- **It doesn't change Momentum.** Coin swaps and coin holders' X shares count as before.
- **It doesn't snapshot over time.** NFT holdings are still read once per epoch ([ADR 0022](0022-club-rewards.md)).

## Consequences

- **Nothing to migrate.** No standalone memecoin was listed.
- **A memecoin without a collection can't be listed with a Club.** It can still be verified (`club: false`) so its deals are trusted.
- **The epoch builder reads one balance per member per Club,** not two: `holderShares` in `web/lib/server/rewards.ts`. `REWARDS.defaultCoinUnit` is gone.
- **Copy changed:** "every collection and memecoin gets a Club" now says collections, with the coin coming along, on the home page, the Clubs list, the Guide and the Rewards tab.
