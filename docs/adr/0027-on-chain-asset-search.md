# ADR 0027: On-chain asset search, with your holdings first

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Builds on [ADR 0014](0014-verified-collections-list.md) (the verified list) and [ADR 0020](0020-server-side-deal-book.md) (server-side search). Replaces the "no indexer, so no 'all collections' and no 'everything I own'" limit in [05 · Frontend](../05-frontend.md#choosing-nfts-nft-picker).

## Context

Choosing what to put in a deal meant knowing its contract address. The NFT picker searched only a short list the app already knew (featured, recent, in open deals), an ERC-20 was a pasted address with no search at all, and nothing said what the connected wallet held. The public RPC can't fill the gap: it can't search by name, can't list a wallet's tokens, and caps `eth_getLogs` at 100 blocks ([ADR 0004](0004-read-deals-from-storage.md)).

## Decision

**One search over tokens and NFT collections, answered by a data provider where it covers the chain and by the chain itself where it doesn't, ranking what the wallet holds first.**

- **`GET /api/search`** (`q`, `owner`, `kind`, `scope`) returns one hit shape for tokens and collections. The provider's key stays on the server (`MORALIS_API_KEY`), and the route is rate-limited per caller like `/api/collection-traits`.
- **Moralis** is the provider (`lib/server/chainSearch.ts`): a wallet's tokens (`/wallets/{address}/tokens`), a wallet's collections with counts (`/{address}/nft/collections`) and token search by name or symbol (`/tokens/search`). It covers Monad mainnet only, so the adapter is off on testnet. It is a small interface (`Provider`), so another vendor can replace it.
- **Without the provider, the chain answers** for the assets the app knows: the verified list and the featured collections, with the wallet's balances read from each contract (`balanceOf` by multicall). If the provider fails on mainnet, the same path answers and the response says `degraded`.
- **Ranking** (`rankHits`): what the wallet holds, then verified assets, then the rest; spam last. Within a group, closer matches first (exact, prefix, word, substring), then holdings by USD value. With no text the picker opens on the wallet's holdings.
- **Give side vs. want side.** Where the wallet is giving, the picker starts on **My holdings** with an **All** switch. Where it is asking, it searches everything with the wallet's holdings still first.
- **ERC-20 rows get a picker** (`TokenPicker`) beside the address field, which still works.

## Safety

- **A hit is a pointer, not a fact.** Names and logos come from a provider and can say anything. Only the verified list ([ADR 0014](0014-verified-collections-list.md)) can earn a **Verified** badge, a blocked asset is dropped from every result, and the address is on every row. A pasted address is still read from its contract (`supportsInterface`, `symbol`, `decimals`) before it can be chosen, and the editor reads a token's symbol and decimals from the token as before.
- **Provider text is cleaned** (control characters removed, lengths capped, logos only `http(s)` or inline images) before it reaches the page. The provider's spam flag shows as *Possible spam*, sorts last, and spam is excluded from a wallet's holdings.
- **Cost.** Provider calls are shared for 30 seconds per wallet and per query, the search box waits for a pause in typing, and a wallet's collections call is the dear one.

## What it does not do

- **It doesn't search every NFT collection by name.** Moralis has no collection-name search, so an unheld collection is found by name only if it is verified, featured, recent or in an open deal. Anything else is found by pasting its address.
- **It doesn't cover Monad testnet with a provider.** There, holdings are only those of known assets. Add a provider that covers testnet, or an indexer ([ADR 0003](0003-no-indexer-in-v1.md)), to change that.
- **It doesn't make anything trusted.** Verified still means "on our reviewed list" and nothing else.
