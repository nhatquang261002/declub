# ADR 0052: `rewards:verify` checks the epoch's fees against the chain's `FeeCharged` logs

**Status:** Accepted · 2026-10-08 · Web scripts only. No contract change. Extends the pre-signing check of [ADR 0022](0022-club-rewards.md) and uses the HyperSync access of [ADR 0051](0051-hypersync-for-the-fill-watcher.md).

## Context

An epoch pays out the fees the Clubs' swaps earned. The builder takes them from the server's own records: the activity log for escrow deals, and the settlement receipts for signed swaps. `rewards:verify` could not compare them with the chain, because both contracts emit a `FeeCharged` for every fee and the public RPC answers `eth_getLogs` for 100 blocks at a time, about a hundredth of an epoch. So a store with inflated fees built an epoch that passed the check and asked the Safe to fund more than the protocol had collected.

## Decision

With `ENVIO_API_TOKEN` set, `rewards:verify` reads every `FeeCharged` of `DeClubEscrow` and `DeClubIntents` in the epoch's window with HyperSync and fails if the Clubs were credited more than was charged.

- **A ceiling, not an equality.** The deal fees credited (each Club's `fees` less its `signedFees`) must not exceed the escrow's `FeeCharged` total, and the signed fees credited must not exceed the intents contract's. Fees the Clubs weren't credited with are normal: a swap that names no listed Club pays a fee no Club gets, and a swap in several Clubs leaves rounding dust.
- **The window is padded by 15 minutes each side** (`FEE_WINDOW_SLACK`). A signed swap is stamped by the matcher rather than its block, so one at the edge may fall either side. Inflation of less than 15 minutes of fees can still pass.
- **Only final blocks.** The window ends at the lower of the node's finalized block and HyperSync's height. If the window runs past that the check says so and doesn't run.
- **No token, no check.** Without `ENVIO_API_TOKEN` the script prints that fees weren't checked against the logs, and the other checks run as before. A signer who wants this check sets the token. A skipped check is a note, not a pass.

## Alternatives

- **Per-swap matching** (each swap in the epoch against its own `FeeCharged`). Stronger, but the stored epoch doesn't keep its swaps, and adding them changes the record every signer already knows.
- **Scanning the node's logs.** About 10,000 queries for a week of testnet blocks; not practical.

## Consequences

- A wrong or tampered fee total fails the check before a Safe signs, where before only the claim delay and the public epoch data stood against it. [04 · Security](../04-security.md) keeps the rest of what the check can't do: it still doesn't say who earned what.
- A slow or stalled Envio connection can make the check take minutes. It reads only.
- Another use of a free token's 15 requests a minute: about 2 per contract per epoch, plus pages.
