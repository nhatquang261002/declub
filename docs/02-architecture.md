# 02 · Architecture

## System overview

```text
 ┌──────────────────────────── Browser ────────────────────────────┐
 │                                                                  │
 │  Next.js (App Router, TypeScript, Tailwind)                      │
 │    ├─ pages: Open Trades · My Chogs · Create · Trade #id · History│
 │    └─ hooks: useTrades · useTrade · useMyChogs · useTxFlow        │
 │                         │                                         │
 │                 wagmi  +  viem  (+ injected wallet)               │
 └─────────────────────────┬────────────────────────────────────────┘
                           │  JSON-RPC (reads, eth_getLogs, sendTx)
                           ▼
 ┌─────────────────────── Monad testnet (10143) ───────────────────┐
 │                                                                  │
 │   ┌──────────────┐   setApprovalForAll    ┌──────────────────┐   │
 │   │  Chog NFT    │◄───────────────────────│    ChogSwap      │   │
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

### ChogSwap contract (`contracts/src/ChogSwap.sol`)

A single contract with no upgrade proxy and no admin. It does four things:

| Responsibility | How |
|---|---|
| Trade state | `mapping(uint256 => Trade)` plus a sequential `tradeCount` |
| Escrow | Holds the maker's Chogs (as ERC-721 owner) and MON (as its own balance) |
| Settlement | `fillTrade` does all four transfers in one call |
| Refunds | `cancelTrade` (maker), `reclaimExpired` (anyone, after expiry), `withdraw` (MON pull fallback) |

The full spec is in [03 · Contract Design](03-contract-design.md) and the interface is [`IChogSwap.sol`](../contracts/src/interfaces/IChogSwap.sol).

### Chog collection

- **Testnet:** `MockChog`, an `ERC721Enumerable` with open minting and on-chain SVG metadata including traits. It is deployed first, and its address is passed to the `ChogSwap` constructor.
- **Production:** the real Chog contract, set through `CHOG_ADDRESS`. Before switching, check whether it supports `ERC721Enumerable` (this affects how the frontend lists Chogs; see [05 · Frontend](05-frontend.md#listing-a-wallets-chogs)).

### Frontend (`web/`)

Next.js + wagmi + viem + Tailwind. It talks to the chain directly and has no backend in v1. See [05 · Frontend](05-frontend.md).

### Indexer (deferred)

Not in v1. The frontend rebuilds trade lists from contract events plus `getTrade` reads. Add an indexer when event scans get slow or when search and filters are needed. See [ADR 0003](adr/0003-no-indexer-in-v1.md).

## Key flows

### Create

```text
Maker                 Chog NFT                 ChogSwap
  │ setApprovalForAll(ChogSwap) ─►│                     │   (once per wallet)
  │ createTrade(offered, requested, reqMon, taker, expiry) {value: offeredMon}
  │ ─────────────────────────────────────────────────────►│
  │                               │◄─ transferFrom(maker→swap) × offered
  │                               │                     │── emit TradeCreated
  │◄──────────────────────────── tradeId ───────────────│
```

### Fill (atomic)

```text
Taker                 Chog NFT                 ChogSwap                 Maker
  │ setApprovalForAll(ChogSwap) ─►│                     │                    │
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
Maker ── cancelTrade(id) ──► ChogSwap ── transferFrom(swap→maker) × offered
                                      └─ offeredMon → maker (or credit)
Anyone ─ reclaimExpired(id) ─► same refund path, only if expired
```

## Repo layout

```text
chog-swap/
├── docs/          ← you are here
├── contracts/     Foundry: src/, test/, script/, lib/ (forge install)
└── web/           Next.js app (Phase 2)
```

## Network

| | Testnet | Mainnet |
|---|---|---|
| Chain id | 10143 (confirmed against the live RPC, 2026-09-28) | 143 (unverified) |
| RPC | `https://testnet-rpc.monad.xyz` | TBD |
| Explorers | [MonadVision](https://testnet.monadvision.com/), [Monadscan](https://testnet.monadscan.com/) | |
| Verification | Sourcify: `https://sourcify-api-monad.blockvision.org/` | |

Both contracts' creation bytecode (solc 0.8.28, `evm_version = prague`) was gas-estimated against the Monad testnet node, so Monad's own EVM accepts it, not only Foundry's local EVM.

A few Monad specifics that affect the design:

- **Fast blocks:** the UI can wait for the transaction receipt instead of showing long "pending" states.
- **Gas is charged on the gas limit, not gas used:** give fills sensible explicit limits rather than inflated defaults. Confirm this against Monad's docs.
- **`eth_getLogs` block-range limits** on public RPCs: event scans have to be chunked, starting from the deploy block (`NEXT_PUBLIC_CHOG_SWAP_DEPLOY_BLOCK`).
