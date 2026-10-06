# web/

The DeClub frontend: Next.js 16, wagmi, viem, Tailwind and Privy. Transactions
go directly from the browser to Monad testnet. Server routes store profiles,
Clubs, signed posts, follows, rewards and the searchable deal book.

**Status:** built. The remaining release work is a testnet deployment of the
current contracts and a manual click-through with real wallets. See the
[root roadmap](../docs/06-roadmap.md).

## Run

```bash
cd web
npm install
npm run dev
```

Set public values in the repo-root `.env` (see [`.env.example`](../.env.example)).
Put server secrets in `web/.env.local`. The app defaults to Monad testnet and
the testnet MockChog. Deals and signed swaps remain disabled until their
contract addresses are configured.

With `NEXT_PUBLIC_PRIVY_APP_ID`, the header offers social sign-in and wallets.
Without it, the app uses an injected wallet. Either way, use Monad testnet
(chain 10143) with test MON.

Without Upstash credentials, local development uses an in-memory store.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL` | root `.env` | Chain and RPC |
| `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS` | root `.env` | `DeClubEscrow` |
| `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` | root `.env` | `DeClubIntents` |
| `NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS` | root `.env` | `DeClubRewards` |
| `NEXT_PUBLIC_POOL_URL` | root `.env` | Intent pool |
| `NEXT_PUBLIC_CHOG_ADDRESS` | root `.env` | Chog collection |
| `NEXT_PUBLIC_PRIVY_APP_ID` | root `.env` | Privy sign-in |
| `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS` | root `.env` | Embedded wallets |
| `PRIVY_APP_SECRET` | `web/.env.local` | Server-side Privy |
| `PRIVY_WEBHOOK_SIGNING_SECRET` | `web/.env.local` | Privy webhook verification |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `web/.env.local` | Persistent store |
| `CRON_SECRET` | `web/.env.local` | Fill watcher authorization |
| `FILL_WATCHER_START_BLOCK` | `web/.env.local` | Fill watcher start |
| `CLUB_ADMIN_USER_IDS` | `web/.env.local` | App administrators |
| `X_BEARER_TOKEN` | `web/.env.local` | Optional X reach |
| `TRUST_PROXY` | host environment | Proxy-aware rate limits |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Build and serve production |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run web unit tests |
| `npm run abi` | Regenerate `lib/abi.ts` from Foundry artifacts |
| `npm run rewards:epoch [-- --publish]` | Build and optionally publish a rewards epoch |

See [docs/09-clubs.md](../docs/09-clubs.md) for Club behavior,
[docs/10-privy.md](../docs/10-privy.md) for identity setup, and
[docs/12-demo.md](../docs/12-demo.md) for the demo world.

## Operations

Schedule `GET /api/cron/fills` with `CRON_SECRET` so fills and Club activity
are recorded even when the app did not observe the transaction.
