# ADR 0051: The fill watcher finds transactions with Envio HyperSync

**Status:** Accepted · 2026-10-08 · Web only. No contract, matcher or pool change. Amends [ADR 0019](0019-fill-watcher.md) (how the watcher finds transactions, not what it records).

## Context

ADR 0019 scans `TradeFilled` and `TradeCreated` with `eth_getLogs`, which the public RPC answers for 100 blocks at a time. Monad makes about 150 blocks a minute, so a run covers about 22,000 blocks, a backfill from the deploy block takes several runs, and a scheduler that runs less than once a minute falls behind. ADR 0019 named a hosted indexer as the answer if that became a problem.

## Decision

When `ENVIO_API_TOKEN` is set, the watcher asks [Envio HyperSync](https://docs.envio.dev/docs/HyperSync/overview) which transactions emitted the two events, instead of the node.

- **Only discovery changes.** HyperSync returns transaction hashes. Each one still goes through `recordFills` and `recordActivity`, which read the receipt from the node and trust nothing else. A wrong or missing answer from Envio can delay a record, never forge one.
- **Both must have a block.** The scan stops at the lower of the node's finalized head and HyperSync's own height, so the cursor never passes a block Envio hasn't indexed or one that could still be reorganised.
- **Wide ranges.** A scan covers 200,000 blocks at a time (`HYPERSYNC_RANGE`, about a day), following the query's `nextBlock` until the range is done. A run makes about two requests (the height and one range), and a backfill of the first 420,000 blocks on testnet three more, which fits the free token's 15 requests a minute. The cursor, lease, time budget and idempotent recording of ADR 0019 are unchanged.
- **Envio down, node instead.** If HyperSync can't answer the height (the client gives up after 5 s and 3 retries), that run scans the node's logs as in ADR 0019 and logs a warning; the next run tries HyperSync again. A failure after the height was read fails the run and leaves the cursor, as any failed run does.
- **No token, no change.** Without `ENVIO_API_TOKEN` the watcher scans the node's logs as before, so development, tests and a deploy without a token keep working.
- **One code path for both flavors.** The URL is `https://<chain id>.hypersync.xyz`, from the chain the build is configured for.
- **The token is a server secret.** It is read from the environment on the server, never under a `NEXT_PUBLIC_` name, and not logged. The client is a native module, kept out of the bundle (`serverExternalPackages`).

## Alternatives

- **HyperIndex for the deal book** (a hosted GraphQL index of deals). A second source of truth for what ADR 0020 already reads from storage; kept for later.
- **HyperRPC as the node.** Larger log ranges behind a plain RPC URL, but it serves only some JSON-RPC methods, and the watcher needs receipts and the finalized tag as well.

## Consequences

- A backfill from the deploy block (`FILL_WATCHER_START_BLOCK`) takes a few runs at most, where ADR 0019 needed one per 22,000 blocks.
- A new dependency on a hosted service, optional. Its rate limit is per token and shared by everything using it, 15 requests a minute on the free plan (HTTP 429 over it). A scheduler that calls the route more than about every 8 seconds, or a second app on the token, would hit it. A run that is refused falls back or fails and retries from the cursor.
- On testnet from one network, a few connections to `10143.hypersync.xyz` stalled for their whole timeout (one of its addresses didn't answer). The fallback keeps the watcher moving through that.
- A new threat row in [04 · Security](../04-security.md): Envio is read-only input to the watcher and can't make it record anything the chain doesn't say.
