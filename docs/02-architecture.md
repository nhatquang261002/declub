# 02 · Architecture

## System overview

```text
 ┌─────────────────────────────── Browser ────────────────────────────────┐
 │  Next.js (App Router, TypeScript, Tailwind)                            │
 │    ├─ pages: / · /deals · /create · /v2/deal/[id] · /intent/[hash]     │
 │    │         /history · /clubs · /clubs/[address] · /account · /guide  │
 │    └─ hooks: useDealBook · useDealsV2 · useDealV2 · usePool            │
 │              useFills · useNotifications · useTxFlow · useSignFlow     │
 │  wagmi + viem, Privy sign-in (injected-wallet fallback)                │
 └────┬───────────────────┬─────────────────────────────────┬─────────────┘
      │ RPC reads, txs    │ /api/*                          │ intents (HTTP)
      │ EIP-712 sigs      ▼                                 ▼
      │   ┌── Next.js server (web/app/api) ───┐   ┌────── matcher/ ──────┐
      │   │ /api/deals: book of V2 + pool     │   │ pool: HTTP + sqlite  │
      │   │ /api/cron/fills: fill watcher     │   │ matcher: pairs and   │
      │   │ /api/webhooks/privy (svix)        │   │ rings of up to 4,    │
      │   │ profiles, saves, Clubs, activity  │   │ simulate → settle    │
      │   │   └─► Upstash Redis               │   └─────────┬────────────┘
      │   │                                   │             │
      │   └───────────────┬───────────────────┘             │ settle(cycle, sigs)
      │                   │ storage reads, receipts,        │
      │                   │ 100-block log scans             │
      ▼                   ▼                                 ▼
 ┌──────────────────────── Monad testnet (10143) ─────────────────────────┐
 │  ┌─────────────────────────┐         ┌─────────────────────────────┐   │
 │  │ OnDealV2                │         │ OnDealIntents               │   │
 │  │ locked deals: exact,    │         │ signed swaps: pairs and     │   │
 │  │ trait, open offers;     │         │ rings, wallet to wallet;    │   │
 │  │ fee in MON per side     │         │ fee in WMON per maker       │   │
 │  └────────────┬────────────┘         └──────────────┬──────────────┘   │
 │               └─────── both inherit FeeAdmin ───────┘                  │
 │                                  │ transfers                           │
 │                                  ▼                                     │
 │                      any ERC-721 · any ERC-20 · MON                    │
 │                                                                        │
 │  OnDeal (v1, legacy: one Chog collection + MON; not used by the app)   │
 └────────────────────────────────────────────────────────────────────────┘
```

No indexer: deals are read from storage ([ADR 0003](adr/0003-no-indexer-in-v1.md), [0004](adr/0004-read-deals-from-storage.md)).

## Components

### OnDealV2 (`contracts/src/OnDealV2.sol`)

The deal contract the app uses ([ADR 0005](adr/0005-generic-asset-model.md)). No upgrade proxy. A trade is two `Asset[]` (ERC-721, ERC-20, MON, or an `ERC721Trait` request), up to 10 per side.

| Responsibility | How |
|---|---|
| Trade state | `mapping(uint256 => Trade)` plus a sequential `tradeCount` |
| Escrow | Holds the maker's offered assets, and each proposal's assets on an open offer |
| Settlement | `fillTrade` / `fillTraitTrade` / `acceptProposal` pay both sides in one call |
| Refunds | `cancelTrade` (maker), `reclaimExpired` (anyone, after expiry), `rejectProposal` / `withdrawProposal`, and `claim` (pull fallback when a push fails) |
| Fee | A flat MON fee per side of a completed deal, recorded on the trade at creation ([ADR 0015](adr/0015-protocol-fee.md)) |

### OnDealIntents (`contracts/src/OnDealIntents.sol`)

Settles signed EIP-712 intents wallet to wallet, nothing escrowed ([ADR 0008](adr/0008-trade-intents.md), [0009](adr/0009-ring-swaps.md)). `settle(cycle, signatures)` takes a pair or a ring of up to 4 and re-checks every signature, nonce, deadline and transfer. Each maker pays the fee in WMON, capped by the `maxFee` they signed. Domain `("OnDealIntents", "3")`.

### FeeAdmin (`contracts/src/FeeAdmin.sol`)

Shared by both contracts ([ADR 0018](adr/0018-adjustable-protocol-fee.md)). The fee admin can cut the fee at once, or raise it after a 7-day delay (`setFee`, then `applyFee`), never above a ceiling fixed at deploy (at most 500 MON). Admin transfer is two-step, and `renounceFeeAdmin` fixes the fee for good. The admin can't touch escrow or deals.

### OnDeal v1 (`contracts/src/OnDeal.sol`), legacy

The original contract: one Chog collection plus MON, no admin, no fee. Still in the repo and on testnet, but the app no longer reads or writes it ([ADR 0020](adr/0020-server-side-deal-book.md)).

The full specs are in [03 · Contract Design](03-contract-design.md); the interfaces are in [`contracts/src/interfaces/`](../contracts/src/interfaces/).

### Chog collection

- **Testnet:** `MockChog` (open mint, on-chain SVG and traits) or the `ChogGenesisMirror` of the real collection's metadata. Set through `CHOG_ADDRESS` / `NEXT_PUBLIC_CHOG_ADDRESS`; the app gives Chog tokens its own artwork.
- **Production:** the real Chog contract. The app trades any ERC-721, so Chog is only one collection among others.

### Frontend (`web/`)

Next.js + wagmi + viem + Tailwind, with Privy for sign-in and linked accounts ([ADR 0010](adr/0010-privy-sign-in.md)). It sends every transaction from the browser and reads most things straight from the chain. Its server routes (`web/app/api`) keep profiles, saves and Clubs in Upstash Redis ([ADR 0011](adr/0011-verified-profiles.md), [0012](adr/0012-server-side-saves.md), [0016](adr/0016-clubs-and-momentum.md)), hold the deal book so it can be searched and filtered whole (`/api/deals`, [ADR 0020](adr/0020-server-side-deal-book.md)), follow the chain for fills from a cron (`/api/cron/fills`, [ADR 0019](adr/0019-fill-watcher.md)), and take Privy's webhook (`/api/webhooks/privy`, [ADR 0013](adr/0013-privy-webhooks.md)). See [05 · Frontend](05-frontend.md).

### Intent pool and matcher (`matcher/`)

A small Node service for signed intents ([ADR 0008](adr/0008-trade-intents.md), [0009](adr/0009-ring-swaps.md)). The **pool** is an HTTP API that verifies and stores EIP-712 intents and keeps them honest against the chain. The **matcher** finds pairs and rings of up to four, runs `settle` as an `eth_call`, and only then sends it. Neither is trusted for safety: `OnDealIntents` re-checks every signature, nonce and transfer. It runs locally with a funded testnet key, and anyone can run their own. Details in [`matcher/README.md`](../matcher/README.md).

### Indexer (deferred)

Still deferred. Deals are read from storage (`tradeCount` + multicall `getTrade`), since the public RPC caps `eth_getLogs` at 100 blocks; the server keeps the whole book in memory for search and filters ([ADR 0020](adr/0020-server-side-deal-book.md)), and a cron follows fills ([ADR 0019](adr/0019-fill-watcher.md)). Add an indexer when re-reading the open deals every few seconds gets expensive, or for history only events hold. See [ADR 0003](adr/0003-no-indexer-in-v1.md) and [ADR 0004](adr/0004-read-deals-from-storage.md).

## Key flows

### Create (locked deal)

```text
Maker                          Token contracts                 OnDealV2
  │ approve / setApprovalForAll(OnDealV2) ──►│                      │  (once per token)
  │ createTrade(offered, requested, taker, expiry)                  │
  │   {value: offered MON + fee}  (or createTraitTrade / createOpenOffer)
  │ ───────────────────────────────────────────────────────────────►│
  │                                          │◄── transferFrom(maker → escrow) × offered
  │                                          │                      │── emit TradeCreated
  │◄──────────────────────────── tradeId ───────────────────────────│
```

### Fill (atomic)

```text
Taker                          Token contracts                 OnDealV2              Maker
  │ approve requested tokens ───────────────►│                      │                   │
  │ fillTrade(id) {value: requested MON + fee}  (fillTraitTrade with proofs)            │
  │ ───────────────────────────────────────────────────────────────►│                   │
  │                                          │   status = Filled (effects first)        │
  │                                          │◄── taker → maker  × requested ──────────►│
  │◄─────────────────────────────────────────│◄── escrow → taker × offered              │
  │                                          │                      │── both fees → fee recipient
  │                                          │                      │── emit TradeFilled
```

If any step reverts (the taker no longer owns a requested NFT, approval is missing, the MON is wrong, or the deal has expired), the whole transaction reverts and nothing moves. A payout that can't be pushed is credited and taken later with `claim`.

### Cancel / reclaim / proposals

```text
Maker ── cancelTrade(id) ──► OnDealV2 ── escrow + maker's fee → maker
Anyone ─ reclaimExpired(id) ─► same refund path, only if expired
Taker ── propose(id, assets) ─► proposal escrowed (open offers)
Maker ── acceptProposal ─► atomic swap · rejectProposal ─► refund to proposer
Proposer ─ withdrawProposal ─► refund
```

### Signed swap (intent settle)

```text
Maker A, B (, C, D)        Pool + matcher                 OnDealIntents
  │ approve give tokens + WMON fee (once)                       │
  │ sign Intent{give, want, feeToken, maxFee, nonce, deadline}  │
  │ ── POST /intents ─────►│ verify, store                      │
  │                        │ find a cycle (2–4) → eth_call      │
  │                        │ settle(cycle, signatures) ────────►│
  │                        │        each give → next maker, fee → recipient
  │◄──────────────── assets arrive wallet to wallet ────────────│
```

## Repo layout

```text
on-deal/
├── docs/          ← you are here
├── contracts/     Foundry: src/, test/, script/, lib/ (forge install)
├── matcher/       Node: intent pool (HTTP + sqlite) and local matcher
└── web/           Next.js app: app/ (pages and api/), components/, hooks/, lib/ (lib/server/ for the API)
```

## Network

| | Testnet | Mainnet |
|---|---|---|
| Chain id | 10143 (confirmed against the live RPC, 2026-09-28) | 143 (unverified) |
| RPC | `https://testnet-rpc.monad.xyz` | TBD |
| Explorers | [MonadVision](https://testnet.monadvision.com/), [Monadscan](https://testnet.monadscan.com/) | |
| Verification | Sourcify: `https://sourcify-api-monad.blockvision.org/` | |

The first deployment's creation bytecode (OnDeal and MockChog; solc 0.8.28, `evm_version = prague`) was gas-estimated against the Monad testnet node before it was sent, so Monad's own EVM accepts it, not only Foundry's local EVM. The later contracts use the same compiler settings and were deployed the same way.

### Deployed (testnet)

The app is configured with:

| Contract | Address | Block |
|---|---|---|
| OnDealV2 | [`0x73591F76d7deE66F683A979cEffb4356982EE1bB`](https://testnet.monadvision.com/address/0x73591F76d7deE66F683A979cEffb4356982EE1bB) | 67163690 |
| OnDealIntents | [`0x54B6d5d25811fe42607a5a9CeBc8F7Bdd58A0Fd2`](https://testnet.monadvision.com/address/0x54B6d5d25811fe42607a5a9CeBc8F7Bdd58A0Fd2) | 67194397 |
| MockERC20 (mUSD) | [`0xd300f095f456D59AAc122B0100833fE195136F6c`](https://testnet.monadvision.com/address/0xd300f095f456D59AAc122B0100833fE195136F6c) | 66874652 |
| Chog collection (ChogGenesisMirror) | [`0x32a325b0640594377d0708ca9081c93da95e1908`](https://testnet.monadvision.com/address/0x32a325b0640594377d0708ca9081c93da95e1908) | 66576933 |

Neither deal contract matches the current source: both predate the fee and `FeeAdmin`, and the intents contract uses the old EIP-712 domain `("ChogSwapIntents", "1")`. Redeploy V2 and Intents before the fee and signed swaps work. Broadcast records, the legacy v1 deployments and the other V2s are listed in the [README](../README.md#deployments-monad-testnet-chain-10143).

A few Monad specifics that affect the design:

- **Fast blocks:** the UI can wait for the transaction receipt instead of showing long "pending" states.
- **Gas is charged on the gas limit, not gas used:** give fills sensible explicit limits rather than inflated defaults. Confirm this against Monad's docs.
- **`eth_getLogs` is capped at 100 blocks** per request on the public testnet RPC (measured 2026-09-28). At ~2 blocks/s, scanning from the deploy block is impractical from a browser, so the app reads storage instead ([ADR 0004](adr/0004-read-deals-from-storage.md)).
