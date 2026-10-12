# Privy in DeClub

Privy is optional identity and account infrastructure for DeClub. The trading contracts do
not depend on Privy: without `NEXT_PUBLIC_PRIVY_APP_ID`, the app uses the injected-wallet
wagmi flow. When Privy is configured, it adds sign-in, linked accounts, wallet switching,
verified profiles, handle-based counterparties, and the identity boundary for server-side
state and Clubs.

## Current implementation

| Capability | Current behavior | Frontend / server surface |
|---|---|---|
| Sign-in | Privy can sign in with a wallet, Google, X, or Discord (`loginMethods: google, twitter, discord, wallet`). Wallet login is shown first (`showWalletLoginFirst`), in the dark theme, on the app's network (Monad testnet, or Monad mainnet in the mainnet flavor). Email is linkable from the account screen but is not currently a configured login method. | `components/ConnectButton.tsx`, `hooks/useSignIn.ts`, `components/Providers.tsx` |
| Linked accounts | A signed-in user can link and unlink email, Google, X, Discord, and wallets. Privy prevents removing the last usable sign-in method. | `/settings`, `components/ConnectButton.tsx` |
| Multiple wallets | Linked wallets are shown on `/settings`; a connected wallet can be made active without changing the account. | `/settings`, `useSetActiveWallet` |
| Embedded wallets | Disabled by default (`createOnLogin: "off"`). Set `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=true` and enable embedded wallets in the Privy dashboard to create one at login for users who have no wallet (`"users-without-wallets"`). | `components/Providers.tsx`, `lib/config.ts` |
| Shared trader profiles | A user explicitly shares an X or Discord profile. Google and email can be linked for sign-in/recovery but are never shown as trader profiles. | `/profile/<address>` (edit), `/api/profile`, `lib/server/profileSync.ts` |
| Handle-based deals | A maker can find a shared X or Discord handle, choose one of that user's shared wallets, and lock the taker address in the deal flow. | `/create`, `/api/profiles/lookup`, `lib/server/handleLookup.ts` |
| Server authorization | Per-user routes accept a Privy access token, verify it server-side, then fetch the user from Privy. The browser cannot choose the user id, handle, or wallet to authorize. | `lib/server/privy.ts`, `lib/server/gate.ts` |
| Clubs | Membership, roles, moderation, and Holder checks are keyed to the Privy user. Linked Ethereum wallets are synchronized so a wallet unlink stops counting for Holder status. | `/clubs`, `/clubs/[address]`, `lib/server/members.ts` |
| Webhook synchronization | Signed Privy user events refresh existing shared profiles and Club wallet membership. Webhooks never publish a profile or create a membership. | `POST /api/webhooks/privy`, `lib/server/privyWebhook.ts` |

The implementation is deliberately fail-closed at the integration boundary:

- Public Privy features are off when `NEXT_PUBLIC_PRIVY_APP_ID` is absent.
- Server identity features are off unless both `NEXT_PUBLIC_PRIVY_APP_ID` and
  `PRIVY_APP_SECRET` are present.
- Webhook processing is off unless the server secret and
  `PRIVY_WEBHOOK_SIGNING_SECRET` are present.
- Invalid or missing Privy access tokens do not identify a user.
- Webhook signatures are verified against the raw request body before the event is read.

## Account and sign-in behavior

The header's wallet control renders one of two modes, selected at build time:

1. **Privy mode** when `NEXT_PUBLIC_PRIVY_APP_ID` is set. The button reads **Sign in**. A user
   can sign in, connect a linked wallet, switch the active wallet, open `/settings`, or sign out.
2. **Injected-wallet mode** when the app id is absent. The button reads **Connect wallet**; wagmi
   exposes installed EIP-6963 wallets and there is no Privy account or linked-account screen.

In both modes a wallet on another chain sees **Switch to Monad Testnet** (**Switch to Monad** in the mainnet flavor). `components/Providers.tsx`
wraps the app in `PrivyProvider` and `@privy-io/wagmi`'s `WagmiProvider` in Privy mode, and in
wagmi's own `WagmiProvider` otherwise.

In Privy mode, a social or email login can return to an account that has no wallet connected
in the current browser. The header offers **Connect wallet** or **Link a wallet**. This is
different from silently creating an embedded wallet: embedded creation only happens when the
explicit environment flag and dashboard setting enable it.

The `/settings` page (Account settings) has three relevant states:

- Privy is not configured: explains that the app is using an installed wallet.
- Privy is configured but the user is signed out: offers **Sign in**.
- The user is signed in: shows linked social/email accounts, linked wallets, active-wallet
  switching, Club rewards and optional embedded-wallet export. The shared-handle, avatar and
  name controls are on the owner's own profile page ([ADR 0042](adr/0042-profile-page.md)).

Unlinking a wallet removes it from Privy sign-in and from the app's linked-wallet identity
set; it does not destroy the wallet or move its assets.

## Verified profiles and handle lookup

Sharing a profile is opt-in. The browser sends only its access token and an instruction to
share, stop sharing, or refresh. The server obtains the user's current linked accounts from
Privy, validates the available profile, and stores the mapping by wallet. A user who has
not enabled sharing is not returned by handle lookup even if Privy knows the social account.

In `/create`, **Only this wallet can accept** (on an open offer, **Only this wallet can send
offers**) accepts an X or Discord handle when Privy is available. **Find** calls `/api/profiles/lookup`; the maker selects one of the wallets that
the shared profile exposes. An unresolved handle cannot pass the review step. The selected
wallet address, not the typed handle, is the on-chain restriction.

The profile displayed beside a wallet is therefore server-derived. It is not accepted from
deal form input and it is not proof that the wallet itself cryptographically belongs to a
social account.

## Webhooks

The route is:

```text
POST /api/webhooks/privy
```

Subscribe the Privy endpoint to:

- `user.linked_account`
- `user.unlinked_account`
- `user.transferred_account`
- `user.deleted`

For each affected user, the handler reads the current linked accounts from Privy, refreshes
an existing shared profile, and synchronizes Club wallets. This current-state read makes
retries, duplicate deliveries, and out-of-order deliveries harmless. A deleted user is
treated as having no linked accounts.

Events unrelated to these user changes are acknowledged without changing application state.
If the signature is invalid, the route returns `401`. If synchronization fails, it returns
`500` so Privy can retry. When the route is disabled or the store is unavailable, it returns
`503`.

## Configuration

Client configuration is build-time configuration:

```dotenv
NEXT_PUBLIC_PRIVY_APP_ID=...
NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=false
```

Server configuration belongs in `web/.env.local` or the hosting provider's environment. The
repo-root `.env` won't do: `next.config.ts` copies only its `NEXT_PUBLIC_*` values into the web
app, so a secret put there is silently ignored.

```dotenv
PRIVY_APP_SECRET=...
PRIVY_WEBHOOK_SIGNING_SECRET=whsec_...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

`UPSTASH_*` is required for persistent profiles, server-side state, and Clubs. The Vercel KV
names `KV_REST_API_URL` and `KV_REST_API_TOKEN` work too, as fallbacks (`lib/server/store.ts`).
Without them, production has no store and those features switch off; development uses an
in-memory store, which is lost on restart and is not a production
persistence strategy.

Pictures in Board posts ([ADR 0056](adr/0056-post-pictures-and-emoji.md)) are kept in a **private** Vercel
Blob store. Create one in the Vercel dashboard (Storage → Blob → Private), connect it to the project (that sets
`BLOB_READ_WRITE_TOKEN`) and use a separate store for each flavor. Without the token, production refuses posts
with a picture and text posts carry on; development keeps pictures in memory.

The Privy dashboard must allow the deployed origin and enable the login methods the app is
expected to expose: wallet, Google, X, Discord, and email if users should be able to link it
for recovery (the app's own config doesn't offer email as a login method). Enable embedded wallets
only when the product decision and `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=true` agree.

For a local webhook test, expose the dev server with a tunnel and register the tunnel URL in
Privy. Production webhook availability and billing depend on the Privy plan in use.

## What remains to validate

The code paths and signed-request tests exist, but live validation is an operational task.
Before calling the Privy integration production-ready, run this checklist against the actual
deployed app and Privy project:

- [ ] Sign in with a wallet; link X, Discord, email, and a second wallet as applicable.
- [ ] Return using Google, X, or Discord and connect or switch to the intended wallet.
- [ ] Enable a shared profile and verify that another browser sees the profile beside the wallet.
- [ ] Find that user by X or Discord handle in `/create`, select the wallet, and complete a
      deal visibility check.
- [ ] Send Privy's dashboard test webhook and confirm a `200` response.
- [ ] Unlink or transfer a throwaway account and confirm the profile and Club wallet state
      refresh after reload.
- [ ] If embedded wallets are enabled, create one, connect it, and verify the export warning.
- [ ] Join a Club, verify Holder status across linked wallets, post, and exercise the relevant
      moderation path with real receipts.

These checks should be marked complete only after the deployed host, real Privy app, real
secrets, and the configured persistence store have all been exercised.
