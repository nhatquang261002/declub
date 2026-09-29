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
- [x] Trade loading from storage: `tradeCount` + multicall `getTrade` ([ADR 0004](adr/0004-read-trades-from-storage.md); the public RPC caps `eth_getLogs` at 100 blocks)
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
- [ ] Search and filters, which probably triggers the indexer ([ADR 0003](adr/0003-no-indexer-in-v1.md))
- [ ] Notifications

## Phase 4: Protocol expansion

- [ ] Generic `Asset[]` model: any ERC-721, ERC-20, native
- [ ] Multi-asset trades
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
