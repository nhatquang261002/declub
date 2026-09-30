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
- [x] History + withdraw (local fill record until an indexer exists)
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
- [ ] Trait requests in V2 (a new `AssetType`), so trait trades can move off v1. Deferred: a design exists ([ADR 0006](adr/0006-trait-requests-in-v2.md)), but it needs a per-collection trait source first
- [ ] Open offers ("make me an offer"): the maker lists assets with a text note and takers escrow proposals. Contract, tests and frontend (create mode, offers list, send / accept / reject / withdraw) done. Not deployed: needs a redeploy of `ChogSwapV2`, and the frontend's `NEXT_PUBLIC_CHOG_SWAP_V2_ADDRESS` pointed at it ([ADR 0007](adr/0007-open-offers.md))
- [ ] Trade intents + off-chain matcher
- [ ] Multi-party ring swaps
- [ ] Reputation
- [ ] External audit before mainnet with real Chogs

## Open questions

| Question | Needed by |
|---|---|
| Real Chog contract address, and is it `ERC721Enumerable`? | Mainnet / Phase 2 "My Chogs" |
| WalletConnect (needs a project id + `@walletconnect/ethereum-provider`)? | Mobile wallets |
| Where do Chog traits live (IPFS JSON? API?), and are they final? | Phase 3 |
| Protocol fee, ever? (v1: none) | Phase 4 |
