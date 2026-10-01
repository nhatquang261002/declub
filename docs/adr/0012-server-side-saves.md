# ADR 0012: Server-side saves: fill history, read markers, recent collections

**Status:** Accepted · 2026-10-01 · Web only. No contract, matcher or pool change. Builds on the store from [ADR 0011](0011-verified-profiles.md); relaxes [ADR 0003](0003-no-indexer-in-v1.md) for fills.

## Context

Three things were kept only in one browser's `localStorage`:

| What | Why it hurt |
|---|---|
| Deals this wallet **filled** (History) | The filler is recorded only in `TradeFilled`, and the public RPC can't scan logs back to the deploy block. A fill from another browser or device never showed up. |
| Which **notifications** were read | Reading one on a phone left it unread on the laptop. |
| **Recently used collections** | The NFT picker's shortlist started empty on every device. |

## Decision

Move each to the Upstash store, and keep the browser as the working copy and the fallback.

- **Fills: the server verifies, the client only reports.** After a confirmed `fillTrade`, `fillTraitTrade` or `acceptProposal`, `useTxFlow` posts the transaction hash to `POST /api/fills`. The server reads the receipt from the RPC itself and records each `TradeFilled` that a swap contract emitted, under its `taker`. That one event covers every way a deal fills, in both contracts: for an accepted proposal the contract emits `TradeFilled(tradeId, maker, proposer)`. The request carries nothing but a hash, so a forged or repeated report records nothing new, and a reverted transaction records nothing. A node that hasn't indexed the receipt yet answers `404`, and the client retries for a few seconds. `GET /api/fills?account&contract` is public (it is chain data) and returns trade ids, newest first, capped at 2,000 per wallet.
- **Read markers and recents: per Privy user.** `GET/POST/DELETE /api/state` need the user's Privy access token, and any wallet named in a call must be linked to that account. The server only ever *adds*: read markers and recents grow, so the browser and the server are merged by union and neither can lose a mark. Keys are validated against a pattern, a request holds at most 500, and a wallet keeps at most 1,000 (oldest age out). `initialized` records that a wallet's first-visit seeding is done, so a second device doesn't re-seed and mark real news as read.
- **The browser stays the working copy.** Every read and write hits `localStorage` first, so no screen waits on a request. Signed in, the hook merges with the server once and pushes what is new. With no store, no Privy secret, or no sign-in, the endpoints answer `{ enabled: false }` and the app behaves as before, so nothing here is required to run it.
- **What stays local, on purpose:** whether to show browser alerts. It is that browser's own notification permission, and syncing it would turn alerts on in a browser that never granted them.

## What it does not do

- **It is not an indexer.** Only fills the app reported are recorded: a fill sent straight to the contract, or made before this shipped, is missing, and existing local records aren't uploaded (the server can't verify them, as the filler isn't in storage). Complete history needs something that reads the chain, and `ingestFills` in `lib/server/fills.ts` is the function a watcher would call: a cron route that scans new blocks (chunked to the RPC's 100-block cap) and passes each transaction hash through it. The matcher's pool already records settled signed intents separately.
- **It doesn't prove the reporter is the filler.** It doesn't need to: the record is what the chain says, whoever reports it.
- **Read markers aren't private from the operator.** They sit in the store beside the user's Privy id, and `DELETE /api/state` removes them.

## Consequences

- A fill is recorded when the filling transaction's tab reports it. Closing the tab in the few seconds after confirmation can lose that one report.
- Turning the store on switches History from this browser's list to the server's. Fills made before then disappear from History unless the deal is the wallet's own (maker) or the watcher above is added.
- The rate limits are per caller IP (see ADR 0011), tighter for fill reports because each one costs an RPC call.
