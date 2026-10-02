# ADR 0016: Clubs, a community per verified asset, and Momentum

**Status:** Accepted · 2026-10-02 · Web and matcher only. No contract change. Builds on [ADR 0011](0011-verified-profiles.md), [0012](0012-server-side-saves.md), [0014](0014-verified-collections-list.md) and [0015](0015-protocol-fee.md). The full spec is [09 · Clubs](../09-clubs.md).

## Context

The app is a set of deals. Nothing gathers the people around one collection or token, and nothing says whether an asset's market is alive. We have what a community needs: signed-in users, verified X profiles, a server store, and a curated list of verified assets.

Constraints:

- **No indexer.** The public RPC caps `eth_getLogs` at 100 blocks ([ADR 0003](0003-no-indexer-in-v1.md), [0004](0004-read-deals-from-storage.md)), and `OnDealV2` stores no creation or fill time.
- **Anything that scores people gets gamed.** A score needs a cost to fake.
- **User-written text is new here.** Until now the server held only small, cosmetic or rebuildable data ([ADR 0011](0011-verified-profiles.md)).

## Decision

**One Club per verified asset, with a board, a members list and an activity score called Momentum.**

- **Only verified collections and memecoins have a Club.** A Club exists for each `verified` NFT collection, and each `verified` ERC-20 whose `category` is `memecoin`, in `web/data/assets.json` (ADR 0014). Verified means a deal in the asset can be trusted, not that it has a community: a stablecoin or wrapped MON is verified and has no Club. A memecoin made for a collection shares that collection's Club (its entry's `club` names the collection), so CHOG and the Chogs are one community with one board, one members list and one Momentum. A clone can't get a fake Club, and moderation stays bounded. Opening one is a pull request and a web deploy, never a contract deploy. An entry marked `blocked` hides its Club. The list can later move to the store with an in-app request queue, in the same format.
- **Anyone signed in can join. Holders get a badge.** The badge comes from an on-chain `balanceOf` across the member's linked wallets, rechecked daily. It is a badge, not a permission.
- **Roles:** app admin (an environment variable), Owner, Moderator, Member. An Owner is claimed by a wallet that is the contract's `owner()`, or assigned by an admin. The Owner appoints Moderators. Every role change and moderation action is logged.
- **Momentum is computed from receipt-verified activity only,** with a 7-day half-life: completed swaps weigh most, deals and intents weigh less and are capped per wallet, posts weigh nothing. The Club score is scaled by the breadth of distinct wallets, and a member's score damps repeat swaps with the same counterparty. A completed swap costs the flat protocol fee on every side ([ADR 0015](0015-protocol-fee.md)), which is what makes faking it cost something.
- **The activity log comes from receipts the server reads itself.** `ingestTx(hash)` decodes `OnDealV2` creations and fills and appends them, idempotently, to the log of each Club named (once, when a deal names both assets of a paired Club); an event that names no Club asset is dropped. The client reports its own transactions, as fills are reported today. Signed swaps come from the matcher's `/settlements`. The matcher gains a `token=` filter. A later cron makes the log complete.
- **Posts are short, plain text, from verified profiles.** 280 characters, no HTML, markdown or links. Only members with a shared verified profile can post, with per-user rate limits. Three distinct reports hide a post, and Moderators decide. A "Looking for" post can link a deal or intent, checked on the server to name the Club's asset.

## What it does not do

- **It doesn't prove a Club, or its asset, is good.** Momentum says "this market has been busy". A well-funded actor can inflate it for $2 a side plus gas. The copy says so.
- **It doesn't restrict trading.** Any asset can still be traded without a Club. The contracts, matcher and pool don't know Clubs exist.
- **It doesn't count deals the app never saw,** until the fill watcher exists. Momentum is "what the app has seen".
- **It isn't a chat.** There are no replies, DMs or reactions in v1.

## Consequences

- **The store now holds data that can't be rebuilt.** Memberships and posts exist nowhere else, so losing the store loses them. The store's own comment, "cosmetic or rebuildable", changes with this ADR. Back up or accept the risk before real communities depend on it.
- **New server surface.** Many routes, three new store ops (set add, remove, count; the rest reuse the ranked set and whole documents) and a new setting: `CLUB_ADMIN_USER_IDS`, plus the existing Privy and Upstash credentials. Clubs are off without a store and Privy, like profiles.
- **Moderation is a real, ongoing job.** An unmoderated board will attract spam and scams aimed at traders. The rules above are a floor. They assume the maintainer or an Owner actually watches the queue.
- **The Privy webhook and profile re-sync now also keep Club wallets in step,** so an unlinked wallet stops counting.
- **First web tests.** The web app gets `node --test`, matching `matcher/`, with the club logic written against a store passed in, so it runs without a server.
- **The matcher changes.** A collection-level key beside `intent_assets`, and `token=` on `/intents` and `/settlements`.
- **Ownership claims are checked once.** If `owner()` changes later, admins are told and decide.
- **Open for later:** moderators chosen by holders, bell notifications for a Club, cross-Club reputation on a profile, Clubs for unverified assets, an on-chain or signed way to prove membership.
