# Privy in On Deal

On Deal is OTC trading between strangers, so the hard problem is trust, not login. Privy is the app's **identity layer**: it says which wallets and which X / Discord account belong to the same person, and the app turns that into things other traders can see and the server can enforce. Sign-in is the smallest part of it.

## What Privy powers

| Feature | Privy feature used | Where |
|---|---|---|
| **Verified trader profiles.** A maker's `@handle` shows beside their wallet on every deal, so a counterparty knows who they trade with. Opt-in, revocable. | Linked accounts (X, Discord, wallets), read server-side with `@privy-io/node` | `app/api/profile`, `lib/server/profileSync.ts`, `components/Who.tsx` ([ADR 0011](adr/0011-verified-profiles.md)) |
| **Profiles kept honest.** An unlinked, transferred or deleted account stops showing, without the owner opening the app. | Webhooks: `user.linked_account`, `user.unlinked_account`, `user.transferred_account`, `user.deleted` (Svix-signed) | `app/api/webhooks/privy`, `lib/server/privyWebhook.ts` ([ADR 0013](adr/0013-privy-webhooks.md)) |
| **One person, many wallets.** Collectors keep a vault and a hot wallet. Link both; switch which one trades on `/account`. | Wallet linking, `useSetActiveWallet` from `@privy-io/wagmi` | `app/account/page.tsx` ([ADR 0010](adr/0010-privy-sign-in.md)) |
| **Clubs: Holder badge across all your wallets.** A Club membership belongs to the Privy user; the Holder check sums `balanceOf` over every linked wallet, and wallets follow the account (via webhook) as they're linked or unlinked. | Linked wallets as the source of truth for membership | `lib/server/members.ts`, `lib/server/memberRoutes.ts` ([ADR 0016](adr/0016-clubs-and-momentum.md)) |
| **Club roles and moderation by person, not wallet.** Roles, bans and app admins are keyed by Privy user id, so swapping wallets doesn't dodge a ban. | Privy user id | `lib/server/boardRoutes.ts`, `CLUB_ADMIN_USER_IDS` ([09-clubs.md](09-clubs.md)) |
| **Per-user server state.** Fill history, notification read markers and recent collections follow the person across devices. | Access token verified server-side | `lib/server/gate.ts`, `app/api/state` ([ADR 0012](adr/0012-server-side-saves.md)) |
| **Wallet connection.** Privy supplies wagmi's connectors; every contract read, write and EIP-712 signature is unchanged. | `@privy-io/wagmi` | `components/Providers.tsx`, `lib/wagmi.ts` |

**The server never trusts the browser about identity.** Every per-user route takes only the access token, verifies it against the app's keys, then reads the user's linked accounts from Privy by id. A request can't name a handle or a wallet.

## Why no embedded wallets

They are off on purpose (`NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS`). On Deal users trade collections they already hold, and those assets live in the wallet they already own. A fresh embedded wallet would be empty, so it couldn't list or fill anything until assets were moved in. It would also weaken the trust signal: "this X account owns this wallet" means something for a wallet with history, and little for a new, empty one, which is exactly what a scammer would use. Privy's job here is to vouch for wallets people bring, not to make new ones.

## Demo script (about 3 minutes)

Two browsers: **A** (the maker, your main wallet) and **B** (a counterparty, a private window with a second wallet).

1. **Wallet-first sign-in.** In A, sign in with the wallet. On `/account`, link X. Link a second wallet too, to show one person with two wallets.
2. **Verified profile.** Still on `/account`, turn on *Show my profile to other traders*. Create a deal (or open one A already made).
3. **What the counterparty sees.** In B, open the deals list and the deal page: the maker shows as `@handle` with the address beside it, and the full address on the deal page so it can be checked. Point out that the handle came from Privy on the server, not from anything A typed.
4. **Clubs.** In A, join a Club. The Holder badge reflects tokens held in *either* linked wallet. Post on the Board.
5. **Webhook.** In the Privy dashboard, open *Users*, find a throwaway user that has shared a profile, and **Delete User**. Privy sends `user.deleted`, and the server removes that user's shared profile and Club memberships. Reload B: the handle is gone and the address shows plain. (Use a throwaway user: deletion can't be undone.)

For step 5, don't unlink X from `/account` to show the webhook: the Account page re-syncs itself when it sees a stale share, so the change can't be credited to the webhook. A dashboard deletion happens outside the app, so only the webhook can explain it. Keep the dashboard's *Webhooks* delivery log open to show the `200`.

Viewers see a changed profile on reload, not live. `useProfile` caches for five minutes in a tab, and `/api/profiles` is cached for 30 s (plus stale-while-revalidate) behind a CDN, so on a deployed host reload a second time if the first still shows the handle.

## Setup for the demo

In `web/.env.local` (server secrets aren't read from the root `.env`):

```bash
NEXT_PUBLIC_PRIVY_APP_ID=...          # Privy dashboard
PRIVY_APP_SECRET=...                  # Privy dashboard, beside the app id
UPSTASH_REDIS_REST_URL=...            # Upstash console > database > REST API
UPSTASH_REDIS_REST_TOKEN=...
PRIVY_WEBHOOK_SIGNING_SECRET=whsec_...  # shown once the webhook endpoint is added
```

In the Privy dashboard:

- Login methods: wallet, Google, X, Discord. Embedded wallets off.
- *Configuration > Webhooks*: add `https://<host>/api/webhooks/privy`, subscribe to `user.linked_account`, `user.unlinked_account`, `user.transferred_account` and `user.deleted`, then send *Test webhook* (`privy.test` answers `200`).
- Webhooks are free in development and need the Enterprise plan in production, so run the demo against the development app. Locally, expose the dev server with `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000` and register the tunnel URL.

## Rehearse first

Per the [roadmap](06-roadmap.md), the Privy pieces are typechecked, built and unit-tested (the webhook with signed requests), but have **not yet run against a real Privy app**. Go through the whole script once with real keys before recording, and check:

- [ ] Wallet sign-in, linking X and a second wallet, switching wallets on `/account`
- [ ] Sharing a profile and seeing `@handle` from browser B
- [ ] *Test webhook* answers `200`
- [ ] Deleting a throwaway user removes the handle (the dashboard shows a `200` delivery)
- [ ] Joining a Club, the Holder badge with tokens in the second wallet, posting on the Board
