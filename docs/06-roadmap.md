# 06 · Roadmap

Status key: `[ ]` todo · `[~]` in progress · `[x]` done

## Phase 0: Foundations

- [x] Repo layout, `.gitignore`, `.env.example`
- [x] Product spec, architecture, contract design, security, frontend docs
- [x] ADRs 0001–0003
- [x] `IChogSwap.sol` interface
- [x] `foundry.toml`, `remappings.txt`

## Phase 1: Protocol

**Goal:** a tested `ChogSwap` deployed to Monad testnet with MockChog.

- [x] Install Foundry (forge 1.8.3)
- [x] `forge install` forge-std + OpenZeppelin v5.7.0
- [x] `MockChog.sol` (ERC721Enumerable, open mint, on-chain SVG + traits)
- [x] `ChogSwap.sol`: create / fill / cancel / reclaimExpired / withdraw
- [x] Unit tests per function (see [04 · Security](04-security.md#test-suite))
- [x] Fuzz tests
- [x] Invariant tests I1–I7 + liveness
- [x] `forge coverage` 100% on ChogSwap, gas measured ([03](03-contract-design.md#gas-bounds))
- [x] Slither run, findings triaged ([04](04-security.md#static-analysis))
- [x] Confirm the Monad testnet chain id, RPC and verifier (10143, Sourcify via MonadVision)
- [x] `script/Deploy.s.sol` + tests, dry run against Monad testnet succeeds
- [x] Deploy and verify on testnet. ChogSwap `0xA3301cec…c298` and MockChog `0x220a2C52…26e4` at block 66352698, both a Sourcify full match (addresses in the [README](../README.md#deployments-monad-testnet-chain-10143))

## Phase 2: Marketplace UI

**Goal:** run the demo end to end in a browser.

- [x] `create-next-app web` (Next.js 16, TS, Tailwind 4, App Router; npm)
- [x] wagmi 3 config + Monad testnet chain + connect button (injected / EIP-6963)
- [x] ABI generation (`@wagmi/cli` Foundry plugin → `web/lib/abi.ts`, `npm run abi`)
- [x] Trade loading from storage: `tradeCount` + multicall `getTrade` ([ADR 0004](adr/0004-read-deals-from-storage.md); the public RPC caps `eth_getLogs` at 100 blocks)
- [x] `useTxFlow` states + error mapping
- [x] Open Trades (Open / For you / All tabs, paging)
- [x] My Chogs (+ MockChog mint panel for demo wallets)
- [x] Create Trade (approval step, form rules)
- [x] Trade Detail (escrow panel, fill / cancel / reclaim)
- [x] History + withdraw (local fill record until an indexer exists; see the server-side record below)
- [x] Server-side saves: fills (receipt-verified), notification read markers and recent collections move to Upstash for signed-in users, with the browser as fallback ([ADR 0012](adr/0012-server-side-saves.md))
- [ ] Fill watcher: a cron that scans new blocks and feeds `ingestFills`, so History also has fills the app never saw ([ADR 0012](adr/0012-server-side-saves.md#what-it-does-not-do))
- [x] `npm run build` + lint clean (Next.js 16.3.6, 7 routes)
- [ ] Manual pass on Monad testnet (create → fill → withdraw with two wallets)
- [ ] Rehearse the demo script ([01 · Product Spec §9](01-product-spec.md#9-demo-script))

## Phase 3: Differentiation

- [x] Trait-based requests using a Merkle set ([design](03-contract-design.md#phase-3-trait-based-requests))
- [x] Trait metadata pipeline (metadata traits → matching ids → root in the create flow)
- [x] Direct-request inbox (the **For you** tab filters open trades by `taker = me`)
- [x] Search and filters on Open Trades, client-side (Chog / trade # / maker address, MON filter, sort by ending soon). Loads up to 200 trades while a filter is active
- [x] Trait search on Open Trades: matches traits of Chogs on either side ("crown", "Hat: Crown"), and names trait-request trades by matching their Merkle root against the catalog
- [ ] Server-side filtering across the whole book, which probably triggers the indexer ([ADR 0003](adr/0003-no-indexer-in-v1.md))
- [ ] Trait lookups for the real Chog collection (search reads MockChog's `traitsOf`; the real one needs the metadata pipeline)
- [x] Notifications: in-app bell + opt-in browser alerts, derived client-side from trade state. Push while no tab is open needs the indexer ([ADR 0003](adr/0003-no-indexer-in-v1.md))

## Phase 4: Protocol expansion

- [x] Generic `Asset[]` model: any ERC-721, ERC-20, native. `ChogSwapV2`, a separate contract beside v1 ([ADR 0005](adr/0005-generic-asset-model.md)); 100% coverage, invariants V1–V7. Deployed to testnet (see the README)
- [x] Multi-asset trades (up to 10 assets per side, any mix; same contract)
- [x] Deploy `ChogSwapV2` to testnet (`script/DeployV2.s.sol`) and verify. `0x8a05…CC75` and a MockERC20 (mUSD) `0xd300…6F6c`, blocks 66874644 / 66874652, both on Sourcify
- [x] Frontend for V2, plumbing: V2 ABI, optional config, `TradeV2` + `toLegacyTrade` adapter, `useTradesV2`, `useTokenInfo`, error copy
- [x] Frontend for V2, create and detail screens (`/v2/create`, `/v2/trade/[id]`): asset editor, exact-amount ERC-20 approvals, NFT collection approvals, accept / cancel / reclaim, `claim`. Typechecked and built; not exercised against a deployed V2 yet
- [x] Frontend for V2, list: a Chogs / Multi-asset switch on Trades and History, V2 cards and filters (search by NFT id, token symbol or address, maker; MON filter; sort), fills remembered per contract. Typechecked, linted and built; the filter logic was checked with sample trades, but the list has not been exercised against the deployed V2 yet
- [x] Trait requests in V2: `ERC721Trait` asset with a Merkle root, `createTraitTrade` with an on-chain spec, `fillTraitTrade`. Several traits per request (any / all), and a server scan of the chosen collection's traits ([ADR 0006](adr/0006-trait-requests-in-v2.md)). Contract and frontend done, 31 tests, 100% coverage. Deployed with open offers (see the README), source-verified; the create and fill screens still need a pass against it
- [x] Open offers ("make me an offer"): the maker lists assets with a text note and takers escrow proposals. Contract, tests and frontend (create mode, offers list, send / accept / reject / withdraw) done. Deployed: `ChogSwapV2` `0x7359…E1bB` at block 67163690 (Sourcify full match), frontend pointed at it. The screens still need a pass against it ([ADR 0007](adr/0007-open-offers.md))
- [~] Trade intents + off-chain matcher ([ADR 0008](adr/0008-trade-intents.md), accepted): signed EIP-712 intents, `ChogSwapIntents` settles wallet to wallet, off-chain pool and matcher. Contract done (65 tests, 100% coverage) and deployed to testnet with `script/DeployIntents.s.sol`: `0x54B6…0Fd2` at block 67194397 (Sourcify full match; its domain separator and intent digest match the matcher's). Pool and local matcher done in [`matcher/`](../matcher/) (58 tests against a local anvil: pairs, rings, revoked approvals, ERC-1271 makers, the HTTP API, the process). Frontend built and merged into the deal screens: a *Sign only* choice on `/create` (EIP-712 signing, approvals, short-deadline default, consent notice), signed swaps tagged **Signed** in the `/deals` and `/history` lists beside locked deals, `/intent/[hash]` (status, cancel, settled cycle), and bell notifications; typechecked, linted and built, the library layer cross-checked against the contract and a live pool, but not yet clicked through with a real wallet on testnet
- [ ] Multi-party ring swaps ([ADR 0009](adr/0009-ring-swaps.md), accepted, `MAX_CYCLE = 4`): cycles of the same signed intents through the same `settle`, so no separate contract. Contract side done (rings of 2–4, worst case 3.3M gas) and the matcher's cycle search is built and tested (three-way ring settled end to end); the "matched in a ring" display is built (`CycleView`), not yet seen with a real ring on testnet
- [x] Privy sign-in, wallet-first (Google / X / Discord / wallet; socials link to a wallet in either order; embedded wallets opt-in) and an account screen to link, unlink and switch wallets ([ADR 0010](adr/0010-privy-sign-in.md)). Optional behind `NEXT_PUBLIC_PRIVY_APP_ID`; typechecked, linted and built in both modes, but not yet signed in with a real Privy app
- [ ] Privy smart wallets: gas sponsorship and batched approvals (needs a paymaster and a check of escrow and `withdraw` with a contract wallet)
- [ ] Reputation
- [ ] External audit before mainnet with real Chogs

## Open questions

| Question | Needed by |
|---|---|
| Real Chog contract address, and is it `ERC721Enumerable`? | Mainnet / Phase 2 "My Chogs" |
| WalletConnect (needs a project id + `@walletconnect/ethereum-provider`)? Privy's sign-in covers most mobile users, so maybe not | Mobile wallets |
| Where do Chog traits live (IPFS JSON? API?), and are they final? | Phase 3 |
| Protocol fee, ever? (v1: none) | Phase 4 |
