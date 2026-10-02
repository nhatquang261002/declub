# ADR 0004: Read trades from storage, not event logs

**Status:** Accepted · 2026-09-28 · amends step 1 of [ADR 0003](0003-no-indexer-in-v1.md)

## Context

ADR 0003 planned to build the trade list by scanning `TradeCreated` logs from the deploy block, in chunks sized to the RPC's range limit.

Probing the public Monad testnet RPC showed that `eth_getLogs` is capped at **100 blocks** per request (`-32614: eth_getLogs is limited to a 100 range`), whatever the filter. Monad makes about 2 blocks a second (~216k a day), so a full scan would cost about 2,000 requests for every day the contract has been live. That doesn't work from a browser.

## Decision

The frontend reads trades from contract storage:

1. `tradeCount()` gives the highest id. Ids are sequential from 1.
2. `getTrade(id)` for the newest N ids, batched into one multicall (viem splits it into several `eth_call`s when it's large). It returns the full terms and the live status.
3. Poll `tradeCount` every 5s and the trade batch every 8s. There's no log subscription.

This needs no contract change: `getTrade` already returns every field, including closed trades' id arrays ([03 · Contract Design](../03-contract-design.md#gas-bounds)).

## Consequences

- Loading costs a few `eth_call`s whatever the chain height. The list pages newest-first ("Load older trades").
- Filtering by maker or by the named `taker` happens client-side over the loaded trades.
- **The one thing storage doesn't hold is who filled a public trade.** That's only in `TradeFilled`. Until there's an indexer, History lists trades this browser filled (saved to `localStorage` when the fill confirms) plus direct offers where `taker` is set. This is a known gap and one of the triggers for the indexer in ADR 0003.
- `NEXT_PUBLIC_ON_DEAL_DEPLOY_BLOCK` is unused for now. It's kept for the indexer's start block.
- An RPC with a larger log range (a paid provider) would make event scans possible again, but the storage path stays simpler.
