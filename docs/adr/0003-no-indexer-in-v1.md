# ADR 0003: No indexer in v1

**Status:** Accepted · 2026-09-28 · step 1 amended by [ADR 0004](0004-read-trades-from-storage.md): the public RPC caps `eth_getLogs` at 100 blocks, so trades are read from storage instead of logs

## Context

The spec's architecture includes an indexer and a database for discovery. For a hackathon-scale MVP, that means running and deploying extra infrastructure, and it becomes a second source of truth that can drift from the chain.

## Decision

v1 has **no indexer and no backend**. The frontend:

1. Scans `TradeCreated` logs from the deploy block (chunked for RPC range limits).
2. Multicalls `getTrade` for the live status.
3. Filters by indexed `maker` / `taker` topics for History and direct requests.

`TradeCreated` carries all the trade terms so this works without extra reads ([03 · Contract Design](../03-contract-design.md#events)).

## When to revisit

Add an indexer (Envio, Ponder, The Graph, or a small custom `viem` watcher + Postgres) when any of these happens:

- Open Trades takes more than ~2s to load.
- History has to show public trades a wallet filled from another browser (only `TradeFilled` records the filler; see ADR 0004).
- Search, filters or sorting are needed (Phase 3).
- Trait-based matching needs a trait → token-id lookup.
- Notifications need a server-side trigger.

The indexer only reads. The chain stays the source of truth, and actions always re-read `getTrade` before sending.
