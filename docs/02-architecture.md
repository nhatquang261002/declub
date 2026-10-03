# 02 · Architecture

## System overview

```text
 ┌──────────────────────────── Browser ────────────────────────────┐
 │                                                                  │
 │  Next.js (App Router, TypeScript, Tailwind)                      │
 │    ├─ pages: Open Trades · My Chogs · Create · Trade #id · History│
 │    └─ hooks: useTrades · useTrade · useOwnedChogs · useTxFlow     │
 │                         │                                         │
 │                 wagmi  +  viem  (+ injected wallet)               │
 └─────────────────────────┬────────────────────────────────────────┘
                           │  JSON-RPC (eth_call/multicall reads, sendTx)
                           ▼
 ┌─────────────────────── Monad testnet (10143) ───────────────────┐
 │                                                                  │
 │   ┌──────────────┐   setApprovalForAll    ┌──────────────────┐   │
 │   │  Chog NFT    │◄───────────────────────│    OnDeal      │   │
 │   │  (ERC-721)   │   transferFrom (pull/  │  escrow + settle │   │
 │   │  MockChog on │   push on fill/refund) │                  │   │
 │   │  testnet     │───────────────────────►│  trades[id]      │   │
 │   └──────────────┘                        │  pendingWithdraw │   │
 │                                           └────────┬─────────┘   │
 │                                                    │ events       │
 └────────────────────────────────────────────────────┼─────────────┘
                                                      ▼
                            TradeCreated · TradeFilled · TradeCancelled
                            TradeReclaimed · WithdrawalCredited · Withdrawn
                                                      │
                                   (Phase 3+) ────────▼─────────
                                   Indexer → DB → /api  (ADR 0003)
```

## Components

### OnDeal contract (`contracts/src/OnDeal.sol`)

A single contract with no upgrade proxy and no admin. It does four things:

| Responsibility | How |
|---|---|
| Trade state | `mapping(uint256 => Trade)` plus a sequential `tradeCount` |
| Escrow | Holds the maker's Chogs (as ERC-721 owner) and MON (as its own balance) |
| Settlement | `fillTrade` does all four transfers in one call |
| Refunds | `cancelTrade` (maker), `reclaimExpired` (anyone, after expiry), `withdraw` (MON pull fallback) |

The full spec is in [03 · Contract Design](03-contract-design.md) and the interface is [`IOnDeal.sol`](../contracts/src/interfaces/IOnDeal.sol).

### Chog collection

- **Testnet:** `MockChog`, an `ERC721Enumerable` with open minting and on-chain SVG metadata including traits. It is deployed first, and its address is passed to the `OnDeal` constructor.
- **Production:** the real Chog contract, set through `CHOG_ADDRESS`. Before switching, check whether it supports `ERC721Enumerable` (this affects how the frontend lists Chogs; see [05 · Frontend](05-frontend.md#listing-a-wallets-chogs)).

### Frontend (`web/`)

Next.js + wagmi + viem + Tailwind. It sends every transaction from the browser and reads most things straight from the chain. Its server routes keep saves, profiles and Clubs, and hold the deal book so it can be searched and filtered whole ([ADR 0020](adr/0020-server-side-deal-book.md)). See [05 · Frontend](05-frontend.md).

### Intent pool and matcher (`matcher/`)

A small Node service for signed intents ([ADR 0008](adr/0008-trade-intents.md), [0009](adr/0009-ring-swaps.md)), and the first backend in the project. The **pool** is an HTTP API that verifies and stores EIP-712 intents and keeps them honest against the chain. The **matcher** finds pairs and rings of up to four, runs `settle` as an `eth_call`, and only then sends it. Neither is trusted for safety: `OnDealIntents` re-checks every signature, nonce and transfer. It runs locally with a funded testnet key, and anyone can run their own. Details in [`matcher/README.md`](../matcher/README.md).

### Indexer (deferred)

Still deferred. Deals are read from storage (`tradeCount` + multicall `getTrade`), since the public RPC caps `eth_getLogs` at 100 blocks; the server keeps the whole book in memory for search and filters ([ADR 0020](adr/0020-server-side-deal-book.md)), and a cron follows fills ([ADR 0019](adr/0019-fill-watcher.md)). Add an indexer when re-reading the open deals every few seconds gets expensive, or for history only events hold. See [ADR 0003](adr/0003-no-indexer-in-v1.md) and [ADR 0004](adr/0004-read-deals-from-storage.md).

## Key flows

### Create

```text
Maker                 Chog NFT                 OnDeal
  │ setApprovalForAll(OnDeal) ─►│                     │   (once per wallet)
  │ createTrade(offered, requested, reqMon, taker, expiry) {value: offeredMon}
  │ ─────────────────────────────────────────────────────►│
  │                               │◄─ transferFrom(maker→swap) × offered
  │                               │                     │── emit TradeCreated
  │◄──────────────────────────── tradeId ───────────────│
```

### Fill (atomic)

```text
Taker                 Chog NFT                 OnDeal                 Maker
  │ setApprovalForAll(OnDeal) ─►│                     │                    │
  │ fillTrade(id) {value: requestedMon} ────────────────►│                    │
  │                               │  status = Filled   (effects first)      │
  │                               │◄─ transferFrom(taker→maker) × requested │
  │                               │◄─ transferFrom(swap→taker)  × offered   │
  │                               │                     │── requestedMon ──►│
  │◄──────────────────────────────── offeredMon ────────│                    │
  │                               │                     │── emit TradeFilled │
```

If any step reverts (the taker no longer owns a requested Chog, approval is missing, the MON amount is wrong, or the trade has expired), the whole transaction reverts and nothing moves.

### Cancel / reclaim

```text
Maker ── cancelTrade(id) ──► OnDeal ── transferFrom(swap→maker) × offered
                                      └─ offeredMon → maker (or credit)
Anyone ─ reclaimExpired(id) ─► same refund path, only if expired
```

## Repo layout

```text
on-deal/
├── docs/          ← you are here
├── contracts/     Foundry: src/, test/, script/, lib/ (forge install)
├── matcher/       Node: intent pool (HTTP + sqlite) and local matcher (Phase 4)
└── web/           Next.js app: app/ (routes), components/, hooks/, lib/ (Phase 2)
```

## Network

| | Testnet | Mainnet |
|---|---|---|
| Chain id | 10143 (confirmed against the live RPC, 2026-09-28) | 143 (unverified) |
| RPC | `https://testnet-rpc.monad.xyz` | TBD |
| Explorers | [MonadVision](https://testnet.monadvision.com/), [Monadscan](https://testnet.monadscan.com/) | |
| Verification | Sourcify: `https://sourcify-api-monad.blockvision.org/` | |

Both contracts' creation bytecode (solc 0.8.28, `evm_version = prague`) was gas-estimated against the Monad testnet node, so Monad's own EVM accepts it, not only Foundry's local EVM.

### Deployed (testnet)

| Contract | Address | Block |
|---|---|---|
| OnDeal | [`0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298`](https://testnet.monadvision.com/address/0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298) | 66352698 |
| MockChog | [`0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4`](https://testnet.monadvision.com/address/0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4) | 66352681 |

Both are source-verified on Sourcify (full match). Deployer: `0x503135438bbc176aea22ec9faaf4470da3272af9`. Transaction record: [`contracts/broadcast/Deploy.s.sol/10143/run-latest.json`](../contracts/broadcast/Deploy.s.sol/10143/run-latest.json).

A few Monad specifics that affect the design:

- **Fast blocks:** the UI can wait for the transaction receipt instead of showing long "pending" states.
- **Gas is charged on the gas limit, not gas used:** give fills sensible explicit limits rather than inflated defaults. Confirm this against Monad's docs.
- **`eth_getLogs` is capped at 100 blocks** per request on the public testnet RPC (measured 2026-09-28). At ~2 blocks/s, scanning from the deploy block is impractical from a browser, so the app reads storage instead ([ADR 0004](adr/0004-read-deals-from-storage.md)).
