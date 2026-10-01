# ADR 0011: Verified profiles, and the first server-side store

**Status:** Accepted · 2026-10-01 · Web only. No contract, matcher or pool change.

## Context

OTC trading between strangers is a scam risk, and a wallet address says nothing about who is behind it. Privy has already verified that a user owns a wallet and an X or Discord account (ADR 0010), but only that user's browser knows. Showing it to other traders needs a server that keeps `wallet → handle`, and until now the web app had nowhere to keep state: it reads contracts and the pool, and everything else is `localStorage`.

## Decision

**Opt-in verified profiles, kept in Upstash Redis.**

- **Opt-in and revocable.** `/account` has "Show my profile to other traders", off by default. Turning it off deletes the rows. A wallet is tied to a real identity only by the owner's choice.
- **X first.** The profile is the user's linked X account, else Discord. Google and email are never shown. Only a handle the provider could have issued is stored (`lib/profiles.ts`), which also makes it safe to put in a URL.
- **The server trusts Privy, not the browser.** `PUT /api/profile` takes the user's access token, verifies it against the app's keys, then reads the user's linked accounts from Privy by id. The request body can't name a handle or a wallet. Privy allows a wallet on one account only, so `wallet → handle` is unambiguous.
- **Kept in step.** Each row records its owner. Re-syncing removes rows for wallets that were unlinked, updates a renamed handle, and removes everything when no social account is left. Deleting or overwriting never touches a row another user owns (a wallet unlinked from one account can be linked to another). The Account page re-syncs on load when it sees a stale share.
- **Public read.** `GET /api/profiles?addresses=…` returns only provider and handle, for up to 50 wallets, cached for 30 s. `<Who>` shows `@handle` with the short address beside it, and the full address on a deal's own page, so the wallet can still be checked. Inside a deal card the handle is plain text, because a link there would nest anchors.
- **A thin store interface** (`lib/server/store.ts`): Upstash over REST, which suits serverless. Without credentials the store is off in production and in-memory in development. All of it is optional: with no store, no Privy secret or no Privy app id, profiles are simply off.
- **Rate limits** by caller IP (a fixed-window counter in the same store) on both routes. The header is only trustworthy behind a proxy that sets it.

## What it does not prove

That an X account and a wallet belong to the same person. Not that the person is honest, and a lookalike handle is still possible. The copy says "linked", not "trusted".

## Consequences

- New server secrets: `PRIVY_APP_SECRET` and the Upstash REST URL and token. They go in `web/.env.local` or the host's environment, not the root `.env` (only `NEXT_PUBLIC_*` is read from there).
- Losing the store loses profiles and nothing else. Nothing in it can move assets or alter a trade.
- Handles are refreshed when the owner opens `/account`, not on every sign-in, so a renamed X account can show the old handle until then. [ADR 0013](0013-privy-webhooks.md) adds a Privy webhook that does the same refresh as soon as an account is linked, unlinked or transferred, when it is configured.
- The store is now available for other small server-side state. [ADR 0012](0012-server-side-saves.md) uses it for fill history, notification read markers and recent collections. Still unbuilt: a cache for finished trait scans (today in process memory, so lost on a cold start) and per-user caps.
