# web/

The DeClub frontend: Next.js 16, wagmi, viem, Tailwind and Privy. Transactions
go directly from the browser to Monad testnet. Server routes store profiles,
Clubs, signed posts, follows, rewards and the searchable deal book.

**Status:** built. `DeClubEscrow` and `DeClubRewards` are deployed on testnet;
`DeClubIntents` is not, so leave `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` blank and
the app hides signed swaps. The remaining release work is that deployment and a
manual click-through with real wallets. See the [root roadmap](../docs/06-roadmap.md).

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
| `NEXT_PUBLIC_POOL_URL` | root `.env` | Signed-swap pool (the matcher) |
| `NEXT_PUBLIC_CHOG_ADDRESS` | root `.env` | Chog collection |
| `NEXT_PUBLIC_PRIVY_APP_ID` | root `.env` | Privy sign-in |
| `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS` | root `.env` | Embedded wallets |
| `NEXT_PUBLIC_REWARDS_EPOCH_SECONDS`, `NEXT_PUBLIC_REWARDS_GENESIS` | root `.env` | Epoch length and start (a week, from Monday 2026-10-05 UTC, by default) |
| `NEXT_PUBLIC_SITE_URL` | root `.env` | Absolute links for share cards (`og:image`) |
| `NEXT_PUBLIC_IPFS_GATEWAY` | root `.env` | Gateway for NFT metadata |
| `MORALIS_API_KEY` | `web/.env.local` | Optional on-chain asset search (Monad mainnet only) |
| `PRIVY_APP_SECRET` | `web/.env.local` | Server-side Privy |
| `PRIVY_WEBHOOK_SIGNING_SECRET` | `web/.env.local` | Privy webhook verification |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `web/.env.local` | Persistent store |
| `BLOB_READ_WRITE_TOKEN` | `web/.env.local` | Pictures in Board posts (a private Vercel Blob store, ADR 0056) |
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
| `npm run dev:testnet` / `dev:mainnet` | Run one flavor (ports 3000 and 3001), each with its own env file |
| `npm run build:testnet` / `build:mainnet`, `start:testnet` / `start:mainnet` | Build and serve a flavor |
| `npm run rewards:epoch:mainnet` | Build a mainnet epoch (publish it from the Safe) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run web unit tests |
| `npm run abi` | Regenerate `lib/abi.ts` from Foundry artifacts |
| `npm run rewards:epoch [-- --publish]` | Build and optionally publish a rewards epoch |

The flavors are explained under [Flavors](../README.md#flavors-testnet-and-mainnet) in the root README.
See [docs/09-clubs.md](../docs/09-clubs.md) for Club behavior,
[docs/10-privy.md](../docs/10-privy.md) for identity setup, and
[docs/12-demo.md](../docs/12-demo.md) for the demo world.

## Operations

Schedule `GET /api/cron/fills` with `CRON_SECRET` so fills and Club activity
are recorded even when the app did not observe the transaction.

Club Rewards also needs `GET /api/cron/holdings` and `GET /api/cron/close` once a
day each with the same `CRON_SECRET` (`web/vercel.json` schedules them on
Vercel). The first samples each Club's members' NFTs so the Holder pool counts
holdings averaged over the week, not just at close; the second freezes the
epoch's inputs just after it ends, so later deletes and hides can't change its
points ([ADR 0040](../docs/adr/0040-points-floor-held-average-public-backing.md)).
Without them the build samples and freezes at build time, as before.
