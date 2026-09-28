# 05 · Frontend

Stack: **Next.js (App Router) · TypeScript · wagmi v2 · viem · Tailwind · @tanstack/react-query** (a wagmi dependency).
There's no backend in v1. Every read and write goes straight to Monad over RPC.

## Planned layout (`web/`)

```text
web/
├── app/
│   ├── layout.tsx              providers (wagmi, react-query), header with connect button
│   ├── page.tsx                Open Trades
│   ├── my-chogs/page.tsx       wallet's Chogs → "Trade this"
│   ├── create/page.tsx         Create Trade form
│   ├── trade/[id]/page.tsx     Trade Detail + actions
│   └── history/page.tsx        my filled / cancelled trades
├── components/
│   ├── ChogCard.tsx  ChogPicker.tsx  TradeCard.tsx  EscrowPanel.tsx
│   ├── TxButton.tsx            wraps the tx state machine below
│   └── ConnectButton.tsx
├── lib/
│   ├── chains.ts               monadTestnet chain definition (defineChain)
│   ├── wagmi.ts                config: injected + WalletConnect
│   ├── contracts.ts            addresses from env + ABIs (exported by forge build)
│   ├── errors.ts               custom error → readable message
│   └── format.ts               MON formatting, relative expiry
└── hooks/
    ├── useTrades.ts            event scan + getTrade → Trade[]
    ├── useTrade.ts             single trade, live status
    ├── useMyChogs.ts           owned token ids + metadata
    ├── useChogApproval.ts      isApprovedForAll / setApprovalForAll
    └── useTxFlow.ts            write → wait for receipt → invalidate queries
```

The ABI goes from `contracts/out/ChogSwap.sol/ChogSwap.json` to `web/lib/abi/ChogSwap.ts` through a small copy script, or through `@wagmi/cli` with the Foundry plugin (preferred, since it generates typed hooks).

## Screens → contract calls

| Screen | Reads | Writes |
|---|---|---|
| **Open Trades** `/` | `TradeCreated` logs → ids; `getTrade(id)` batched with multicall; `isExpired` | — |
| **My Chogs** `/my-chogs` | `balanceOf`, `tokenOfOwnerByIndex`, `tokenURI` | — |
| **Create** `/create` | owned Chogs, `isApprovedForAll(me, swap)`, `ownerOf(requested)` as a hint | `setApprovalForAll` (once), `createTrade{value: offeredMon}` |
| **Trade #id** `/trade/[id]` | `getTrade`, `isExpired`, `ownerOf(requestedIds)`, `isApprovedForAll` | `fillTrade{value: requestedMon}` · `cancelTrade` · `reclaimExpired` |
| **History** `/history` | logs filtered by `maker = me` or `taker = me` (indexed topics) | `withdraw` if `pendingWithdrawal(me) > 0` |

### Trade Detail: which button shows

```text
status == Filled / Cancelled                → read-only badge
status == Open && expired                   → [ Reclaim to maker ] (anyone)   + [ Cancel ] if maker
status == Open && me == maker               → [ Cancel trade ]
status == Open && (taker == 0 || me == taker)
      && I own all requestedIds             → [ Approve ] → [ Accept & Swap ]
otherwise                                   → "You don't own the requested Chogs"
```

The **Escrow panel** keeps the spec's picture: `Maker ✓ deposited` (always true while Open) and `Taker ✗, pays on accept`.

## Listing a wallet's Chogs

- **MockChog** implements `ERC721Enumerable`, so the app calls `balanceOf` and then `tokenOfOwnerByIndex(i)` through multicall.
- **Real Chog:** if it isn't enumerable, fall back to an NFT API (for example, Monad ecosystem indexers) or scan `Transfer` logs. This is the first thing to check once the real address is known.

## Loading trades without an indexer

1. `getLogs(TradeCreated, fromBlock = DEPLOY_BLOCK)` in chunks sized to the RPC's range limit.
2. Decode the terms from the event, then multicall `getTrade` for the live `status`.
3. Cache in react-query and refetch on window focus and after any of our own transactions.
4. Optionally use `watchContractEvent` for live updates.

When this gets slow (thousands of trades), bring in an indexer ([ADR 0003](adr/0003-no-indexer-in-v1.md)).

## Transaction flow (`useTxFlow`)

```text
idle ─click─► awaiting-signature ─signed─► pending ─receipt ok─► confirmed
                     │                        │
                  rejected                reverted ──► error (decoded custom error)
```

- Simulate first (`simulateContract`) so reverts show up before the wallet opens.
- On `confirmed`, invalidate the `trades`, `trade(id)` and `myChogs` queries.
- Set an explicit `gas` from the simulation estimate plus a small buffer (Monad charges on the gas limit).
- Show the explorer link for the transaction hash.

## Error messages

| Contract error | UI copy |
|---|---|
| `TradeNotOpen` | This trade was already filled or cancelled. |
| `TradeIsExpired` | This trade has expired. |
| `NotAllowedTaker` | This is a private offer for another wallet. |
| `SelfFill` | You can't accept your own trade. |
| `WrongMonAmount` | The MON amount doesn't match the trade. |
| `NotMaker` | Only the creator can cancel this trade. |
| `EmptySide` | Add at least one Chog or some MON to each side. |
| `MonOnBothSides` | Put MON on one side only. |
| `TooManyTokens` | Up to 10 Chogs per side. |
| `ExpiryInPast` | Pick an expiry in the future. |
| ERC-721 `ERC721InsufficientApproval` / `ERC721IncorrectOwner` | You need to approve Chog Swap, or you no longer own this Chog. |

## Create Trade form rules (client-side)

- At least one Chog or some MON on each side, and MON on only one side.
- Up to 10 Chogs per side, no duplicates, and nothing on both sides.
- Offered Chogs must be owned by the connected wallet.
- Expiry presets: 1h / 24h / 7d / none. Default 24h.
- Optional "Only this wallet can accept" address field (direct request).
