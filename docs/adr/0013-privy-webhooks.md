# ADR 0013: Privy webhooks keep verified profiles in step

**Status:** Accepted · 2026-10-01 · Web only. No contract, matcher or pool change. Builds on [ADR 0011](0011-verified-profiles.md).

## Context

A shared profile (`wallet → @handle`) is copied from Privy when its owner turns sharing on, and refreshed when they next open `/account`. Between those, it can be wrong in ways that matter to a counterparty:

- The owner **unlinks** their X account, or the wallet, and traders keep seeing the old handle.
- A wallet **moves to another Privy user** (an account transfer or merge), and the previous owner's handle stays on it.
- The user is **deleted**, and their rows stay.

Privy can tell the server when any of these happen.

## Decision

**A webhook endpoint, `POST /api/webhooks/privy`, re-syncs the affected users' shared profiles.**

- **Events:** `user.linked_account`, `user.unlinked_account`, `user.transferred_account` (both users) and `user.deleted`. Register the endpoint in the Privy dashboard under Configuration > Webhooks and subscribe to those. Any other event is acknowledged and ignored.
- **The signature is the only credential.** The route reads the raw body and checks the Svix signature (and its five-minute timestamp window) with `PRIVY_WEBHOOK_SIGNING_SECRET` before anything else, using the `svix` package that `@privy-io/node` already depends on. Failure answers `401`.
- **The payload says who, not what.** Delivery is at-least-once and can be late or out of order, so a replayed "linked" event could arrive after the account was unlinked. The handler takes only the user ids from the event and reads those users' *current* linked accounts from Privy, then runs the same `syncProfile` as `/account`'s refresh (`lib/server/profileSync.ts`, extracted from `PUT /api/profile`). Every delivery therefore converges on the latest state, and a replay is harmless. A user Privy no longer has (404) is treated as having no accounts.
- **It only maintains, never publishes.** The sync runs in refresh mode: it rewrites or removes shares that exist and never starts one. Turning sharing on stays an explicit act by the owner on `/account`.
- **Failure is retryable.** A Privy or store error answers `500` and Privy redelivers on its schedule (immediately, then 5 s up to 10 h). Not configured answers `503`.
- **Optional.** No `PRIVY_WEBHOOK_SIGNING_SECRET` (or no store or Privy secret) turns the route off. Profiles then refresh on `/account` as before.

## What it does not do

- **No transaction or balance events, no embedded-wallet policies.** Those cover only Privy embedded wallets, which the app doesn't use (`NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS` is off). Transaction events also don't fire for transactions sent from MetaMask and similar. If embedded wallets are turned on later, `transaction.confirmed` could feed `ingestFills` ([ADR 0012](0012-server-side-saves.md#what-it-does-not-do)), and a wallet policy could restrict what the embedded wallet signs. Policies are fixed at creation for wallets the user owns, so that would mean creating those wallets server-side.
- **A merge doesn't hand the profile to the surviving user.** The previous owner's rows are removed; the new owner shares again from `/account` if they want to.

## Consequences

- Webhooks are free in development but **need the Enterprise plan in production**. Without it, profiles stay refresh-on-visit.
- Privy delivers from fixed IPs (listed in its docs) and expects a public `https://` URL; to try it locally, tunnel with ngrok or Cloudflare Tunnel and use the dashboard's **Test webhook** (`privy.test` is acknowledged with `200`).
- New server secret: `PRIVY_WEBHOOK_SIGNING_SECRET` (`whsec_…`, shown after the endpoint is added). Like the other server secrets it goes in `web/.env.local` or the host's environment.
- `svix` becomes a direct dependency of `web` at the version already installed.
