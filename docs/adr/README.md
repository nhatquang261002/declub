# Architecture decision records

One file per decision. The status line at the top of each record is the source of truth; this index repeats it in short.

The project was On Deal until [ADR 0021](0021-declub-pivot.md) renamed it DeClub: ADRs 0001–0020 keep the names they were written with (`OnDeal` is the deleted v1 escrow, `OnDealV2` is now `DeClubEscrow`, `OnDealIntents` is now `DeClubIntents`).

| # | Decision | Status | Summary |
|---|---|---|---|
| 0001 | [Atomic fill instead of a two-sided deposit phase](0001-atomic-fill.md) | Accepted | The taker's one transaction pays and receives, so a trade never sits half deposited. |
| 0002 | [Foundry for contracts](0002-foundry.md) | Accepted | forge, cast and anvil in `contracts/`, rather than Hardhat. |
| 0003 | [No indexer in v1](0003-no-indexer-in-v1.md) | Accepted, amended by 0004 | No indexer or database; the chain is the source of truth. Later relaxed for fills (0012) and search (0020), still without an indexer. |
| 0004 | [Read trades from storage, not event logs](0004-read-deals-from-storage.md) | Accepted | The public RPC caps `eth_getLogs` at 100 blocks, so deals are read with `tradeCount` and multicall `getTrade`. |
| 0005 | [Generic asset model in a separate `OnDealV2`](0005-generic-asset-model.md) | Accepted | A new contract beside v1 trades any ERC-721, ERC-20 and MON, in any mix. |
| 0006 | [Trait requests in OnDealV2 as a fourth asset type](0006-trait-requests-in-v2.md) | Accepted, implemented, deployed | `ERC721Trait` assets ask for any NFT with given traits, proven against a Merkle root, with an on-chain spec. |
| 0007 | [Open offers ("make me an offer") with escrowed proposals](0007-open-offers.md) | Accepted | The maker lists assets with no ask; takers escrow proposals and the maker accepts one. |
| 0008 | [Signed trade intents and an off-chain matcher](0008-trade-intents.md) | Accepted | EIP-712 intents lock nothing; a matcher finds fits and `OnDealIntents` settles them wallet to wallet. |
| 0009 | [Multi-party ring swaps](0009-ring-swaps.md) | Accepted | Rings of up to four intents settle through the same `settle` call as pairs. |
| 0010 | [Privy sign-in and linked accounts](0010-privy-sign-in.md) | Accepted | Optional, wallet-first Privy sign-in (Google, X, Discord, wallet), with the injected wallet as fallback. |
| 0011 | [Verified profiles, and the first server-side store](0011-verified-profiles.md) | Accepted | Opt-in X or Discord handles beside a wallet, kept in Upstash Redis. |
| 0012 | [Server-side saves: fill history, read markers, recent collections](0012-server-side-saves.md) | Accepted | Receipt-verified fills and per-user state move from one browser to the store. |
| 0013 | [Privy webhooks keep verified profiles in step](0013-privy-webhooks.md) | Accepted | Svix-verified webhooks re-sync profiles when an account is unlinked, transferred or deleted. |
| 0014 | [A curated list marks which collections and tokens are verified](0014-verified-collections-list.md) | Accepted (list built; UI badges to build) | `web/data/assets.json` marks assets verified or blocked; it changes only what the UI shows. |
| 0015 | [A small flat protocol fee, paid by every side of a completed deal](0015-protocol-fee.md) | Accepted, partly superseded by 0018 | A flat fee per side when a deal completes: MON in `OnDealV2`, WMON in `OnDealIntents`. |
| 0016 | [Clubs, a community per verified asset, and Momentum](0016-clubs-and-momentum.md) | Accepted | A Market, Board and Members per verified asset, with roles and an activity score. |
| 0017 | [Make a deal for @handle](0017-deal-by-handle.md) | Accepted | "Who can accept" takes an X or Discord handle and finds the wallets that user shared. |
| 0018 | [An adjustable protocol fee, capped at deploy, with raises on a delay](0018-adjustable-protocol-fee.md) | Accepted | A fee admin can cut the fee at once or raise it after 7 days, never above a ceiling fixed at deploy. |
| 0019 | [Fill watcher: follow the chain for fills and Club activity](0019-fill-watcher.md) | Accepted | A cron route scans new blocks for fills and creations and records them through the receipt checks. |
| 0020 | [Search and filter the whole deal book on the server](0020-server-side-deal-book.md) | Accepted | The server holds every deal in memory and answers searched, filtered pages; OnDeal v1 leaves the app. |
| 0021 | [De(al) Club: Clubs are the product, swaps fund them](0021-declub-pivot.md) | Accepted | The project becomes De(al) Club; contracts and identifiers are renamed, and the v1 escrow is deleted. |
| 0022 | [Club Rewards: a share of the fees goes back to the Club](0022-club-rewards.md) | Accepted | Each epoch, 40% of a Club's swap fees goes to its Holders by holdings and 20% to its Owner, claimed against a Merkle root on `DeClubRewards`. |
| 0023 | [Signed posts, follows and feed lenses](0023-signed-posts-and-lenses.md) | Accepted | Posts and follows are signed by the member's wallet and exported; the reader picks how the Board is ordered. |
