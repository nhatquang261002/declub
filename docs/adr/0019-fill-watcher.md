# ADR 0019: Fill watcher: follow the chain for fills and Club activity

**Status:** Accepted · 2026-10-03 · Web only. No contract, matcher or pool change. Completes the server-side fill history of [ADR 0012](0012-server-side-saves.md) and the Club activity log of [ADR 0016](0016-clubs-and-momentum.md).

## Context

Fills and Club activity are recorded only when the app reports a transaction it sent (`POST /api/activity`). A deal filled straight through the contract, from another front end, or in a tab closed before the report went out was missing from History and from Momentum, and both ADRs named a watcher as the fix. The public RPC answers `eth_getLogs` for at most 100 blocks at a time ([ADR 0004](0004-read-deals-from-storage.md)), and Monad makes about 150 blocks a minute.

## Decision

A cron route follows the chain from a cursor and feeds what it finds through the same receipt checks a report goes through.

- **`GET /api/cron/fills`**, guarded by `Authorization: Bearer <CRON_SECRET>` (the header Vercel Cron sends; any scheduler can send it). Off (`503`) without a store or a secret.
- **Each run** (`watchFills` in `web/lib/server/fillWatcher.ts`) reads the cursor (the last block fully processed), asks for the finalized head, and queries `TradeFilled` and V2's `TradeCreated` from both swap contracts in 100-block chunks, 4 in flight. Every transaction that emitted one goes through `recordFills` and `recordActivity`, which read the receipt themselves. The cursor moves past a chunk only once all its transactions are recorded, and is saved after each chunk.
- **Finalized blocks only**, so a recorded fill can't be reorganised away. On Monad the finalized head is about a second behind the latest.
- **A time budget, not a block budget.** A run starts no new queries after 40 s (`maxDuration` is 60 s), so a backlog is worked off over several runs. Live, a run covers about 11,000 empty blocks in 20 s.
- **One run at a time.** A lease in the store (`hit` with a TTL, deleted at the end) turns an overlapping run away with `{ status: "busy" }`. Overlap would only repeat work: recording is idempotent, a fill is a sorted-set member keyed by trade id and an activity event's id is `txHash:logIndex`.
- **Where it starts.** With no cursor, the first run starts at the head, so only new deals are followed. `FILL_WATCHER_START_BLOCK` makes it start there instead, to backfill (the v1 deploy block, 66352698 on testnet, covers everything). To rescan, delete the key `ondeal:watch:<chain>:fills:cursor`.

## Alternatives

- **A long-running process** (like the matcher) watching blocks. Cheaper per block, but one more thing to host, and the app already has a store and a server.
- **A hosted indexer** (Envio, Ponder, The Graph). Still the answer for server-side filtering of the whole book ([ADR 0003](0003-no-indexer-in-v1.md)); overkill for two event types.

## Consequences

- History and Momentum include deals the app never saw, within a run's interval of the fill. The client's own report stays, so its fills still show at once.
- It needs a scheduler. Vercel Cron on the Hobby plan runs at most once a day, and a run covers about 22,000 blocks (about two and a half hours of chain), so daily runs fall behind. Use Vercel Pro (every minute) or an external scheduler (GitHub Actions, cron-job.org, Upstash QStash) calling the route with the header.
- Each run costs RPC calls: one log query per 100 blocks, about 90 an hour at the head, and one receipt per matching transaction, plus the reads `recordActivity` makes for Club deals.
- Signed swaps aren't in it: the matcher's `/settlements` already has them (ADR 0016).
