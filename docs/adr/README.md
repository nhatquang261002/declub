# Architecture decision records

One file per decision, numbered in the order they were made. The **Status** line at the top of each record is the source of truth; this page is a map. For how things work *now*, read the specs in [docs/](../README.md): a record explains why, and a later record may have changed the details.

**Reading tips**

- "Amended by" means a later record changed part of this one. Read both, newest last.
- ADRs 0001–0020 keep the names they were written with: `OnDealV2` is now `DeClubEscrow`, `OnDealIntents` is now `DeClubIntents` ([0021](0021-declub-pivot.md)).
- To add one: copy the shape of a recent record, take the next number, add a row to the right table below, and link it from the spec it changes.

## Contracts and trading

| # | Decision | Status |
|---|---|---|
| [0001](0001-atomic-fill.md) | Atomic fill: the taker's one transaction pays and receives | Accepted |
| [0002](0002-foundry.md) | Foundry for contracts | Accepted |
| [0005](0005-generic-asset-model.md) | Any ERC-721, ERC-20 and MON in one escrow contract | Accepted |
| [0006](0006-trait-requests-in-v2.md) | Trait requests: ask for any NFT with given traits | Accepted, deployed |
| [0007](0007-open-offers.md) | Open offers with escrowed proposals | Accepted |
| [0008](0008-trade-intents.md) | Signed intents and an off-chain matcher | Accepted |
| [0009](0009-ring-swaps.md) | Ring swaps of up to four parties | Accepted |
| [0015](0015-protocol-fee.md) | A small protocol fee on completed deals | Partly superseded by 0018, 0033 |
| [0018](0018-adjustable-protocol-fee.md) | Adjustable fee: cut at once, raise after 7 days, never above a ceiling | Accepted |
| [0033](0033-fee-per-nft.md) | The fee is paid per NFT moved; a side moves at most 5 | Accepted |

## Reading the chain and the deal book

| # | Decision | Status |
|---|---|---|
| [0003](0003-no-indexer-in-v1.md) | No indexer; the chain is the source of truth | Amended by 0004, relaxed by 0012, 0020 |
| [0004](0004-read-deals-from-storage.md) | Read deals from storage, not event logs | Accepted |
| [0019](0019-fill-watcher.md) | Fill watcher: a cron route records fills and Club activity | Amended by 0051 |
| [0020](0020-server-side-deal-book.md) | The server searches and filters the whole deal book | Accepted |
| [0051](0051-hypersync-for-the-fill-watcher.md) | The fill watcher finds transactions with Envio HyperSync | Accepted |
| [0052](0052-check-epoch-fees-against-fee-logs.md) | `rewards:verify` checks the epoch's fees against `FeeCharged` logs | Accepted |
| [0027](0027-on-chain-asset-search.md) | One on-chain search over tokens and collections | Accepted |

## Identity and profiles

| # | Decision | Status |
|---|---|---|
| [0010](0010-privy-sign-in.md) | Privy sign-in, wallet first | Accepted |
| [0011](0011-verified-profiles.md) | Verified X/Discord profiles; the first server-side store | Accepted |
| [0012](0012-server-side-saves.md) | Fill history, read markers and recents saved per user | Accepted |
| [0013](0013-privy-webhooks.md) | Webhooks keep verified profiles in step | Accepted |
| [0014](0014-verified-collections-list.md) | A curated list marks verified and blocked assets | Accepted |
| [0017](0017-deal-by-handle.md) | Make a deal for an @handle | Accepted |
| [0028](0028-account-avatars.md) | Avatars: an NFT you hold, or an upload | Accepted |
| [0042](0042-profile-page.md) | A profile page for every wallet; `/account` becomes `/settings` | Accepted |

## Clubs: the product

| # | Decision | Status |
|---|---|---|
| [0016](0016-clubs-and-momentum.md) | Clubs and Momentum: a community per verified asset | Accepted, reports amended by 0040 |
| [0021](0021-declub-pivot.md) | De(al) Club: Clubs are the product, swaps fund them | Accepted |
| [0025](0025-clubs-are-for-nft-collections.md) | Only collections have Clubs; a memecoin joins one | Accepted |
| [0026](0026-owner-sets-the-coin-holder-rule.md) | The Owner sets the coin-holder rule | Accepted |
| [0023](0023-signed-posts-and-lenses.md) | Signed posts, follows and feed lenses | Accepted |
| [0030](0030-likes-club-inbox-and-recap.md) | Likes, the Club inbox and the weekly recap | Accepted |
| [0031](0031-share-a-deal-on-x.md) | Share a deal on X | Accepted |
| [0041](0041-timeline.md) | A timeline of Board posts across Clubs | Accepted |
| [0043](0043-system-messages.md) | System messages on the Board and timeline | Accepted |
| [0047](0047-board-posts-in-momentum.md) | A Holder's first Board post of the day counts in Momentum | Accepted |

## Club Rewards and points

Read in this order: the money (0022), then how points work (0038, 0040, 0044), then the add-ons.

| # | Decision | Status |
|---|---|---|
| [0022](0022-club-rewards.md) | Fees go back to the Club: Merkle claims on `DeClubRewards` | Amended by 0054 |
| [0024](0024-x-posts-and-the-holder-bonus.md) | X posts and the Holder bonus | Amended by 0029, 0032, 0044 |
| [0029](0029-top-holders-and-posts-only-bonus.md) | Top Holders are paid; the bonus counts posts only | Amended by 0034, 0037 |
| [0032](0032-live-standings-active-days-and-replies.md) | Live standings, active days, streaks, replies | Accepted |
| [0034](0034-swaps-count-in-the-holder-bonus.md) | Swaps count in the bonus, capped | Accepted |
| [0035](0035-sponsored-epochs.md) | Sponsors add to a Club's Holder pool | Accepted |
| [0036](0036-sponsor-from-the-app.md) | Sponsor from the app, payment checked on chain | Amended by 0053 |
| [0037](0037-most-active-holders-are-paid.md) | The most active Holders are paid, not the biggest | Amended by 0040 |
| [0038](0038-points-from-backing.md) | Points come from what other Holders back | Amended by 0039, 0040 |
| [0039](0039-base-voice-for-verified-accounts.md) | Verified accounts get a small base voice | Accepted |
| [0040](0040-points-floor-held-average-public-backing.md) | Holdings averaged over the week, public backing, moderator-only hides | Floor replaced by 0044 |
| [0044](0044-owner-reward-settings.md) | Owners set how their Club pays; a ramp replaces the floor | Accepted |
| [0046](0046-points-for-engaging.md) | Points for engaging with other members | Accepted |
| [0053](0053-back-up-sponsors-and-members.md) | Back up sponsors and members: kept signatures, export and a checked restore | Accepted |
| [0054](0054-resumable-epoch-build-and-epoch-backup.md) | A resumable epoch build, and a backup of built epochs | Accepted |
| [0055](0055-full-store-dump.md) | A full dump of the server store | Accepted |

## Challenges

| # | Decision | Status |
|---|---|---|
| [0045](0045-club-challenges.md) | The Owner sets a task; winners earn points | Amended by 0048, 0049, 0050 |
| [0048](0048-entries-earn-through-their-challenge.md) | An entry earns through its challenge, not the epoch | Accepted |
| [0049](0049-more-ways-to-pick-challenge-winners.md) | Holder vote, raffle, first N, everyone who completes | Accepted |
| [0050](0050-challenge-rewards-beyond-points.md) | Trophies, NFT/token prizes, pinned results | Accepted |
