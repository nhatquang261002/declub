# web/

The On Deal frontend: Next.js 16 (App Router) · wagmi 3 · viem · Tailwind 4 · Privy. Every transaction is sent from the browser to Monad testnet. Its server routes (`app/api/`, logic in `lib/server/`) keep profiles, saves and Clubs in Upstash Redis, hold the deal book for search, follow the chain for fills, and take Privy's webhook.

**Status:** built. Deals (searched on the server), Create (lock or sign), the deal and signed-swap pages, History, Clubs, Account and the Guide are wired. Left: a click-through on testnet with real wallets, on a redeploy of the current contracts (see the [root README](../README.md#deployments-monad-testnet-chain-10143)).

The logo is drawn inline (`components/Logo.tsx`; the favicon is `app/icon.svg`). From the Chog logo set in [`public/brand/`](./public/brand/) the app uses the face badge and `mon.svg`. Sample NFT artwork in [`public/art/chogs/`](./public/art/chogs/) is used for the Angel/Devil swap art on the home page and as fallback art for those Chog ids. See [08 · Art Direction](../docs/08-art-direction.md).

## Run

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

Set the `NEXT_PUBLIC_*` values in the **repo-root** `.env` (see [`.env.example`](../.env.example)). `next.config.ts` loads that file, but only its `NEXT_PUBLIC_*` keys; `web/.env.local` overrides it and is where the server secrets go. Only the chain, RPC and Chog collection have defaults (`lib/config.ts`; the Chog default is the testnet MockChog). Without `NEXT_PUBLIC_ON_DEAL_V2_ADDRESS` there are no deals outside the development mocks, and without `NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS` (and a running [matcher](../matcher/README.md)) no signed swaps.

With `NEXT_PUBLIC_PRIVY_APP_ID` set, the header shows **Sign in** (Google, X, Discord or a wallet). Without it, **Connect wallet** uses an injected wallet (MetaMask, Rabby, …). Either way you need Monad testnet (chain 10143) and some test MON.

Outside production, mock deals (`lib/demoDeals.ts`) replace the live ones so every deal screen can be reviewed without a wallet or testnet state: Chog deals, multi-asset deals, open offers with offers on them, and signed swaps, in every status. Connect a wallet to see the maker's and taker's views. Writes for a mock deal are refused before reaching the wallet. Set `NEXT_PUBLIC_DEMO_DEALS=false` for normal testnet use.

Without Upstash credentials, the server store is off in production; outside production an in-memory store stands in (lost on restart), seeded with mock Clubs unless `NEXT_PUBLIC_DEMO_CLUBS=false` (`lib/server/store.ts`).

### Environment

| Variable | Where | What |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL` | root `.env` | Default 10143 and the public testnet RPC |
| `NEXT_PUBLIC_ON_DEAL_V2_ADDRESS` | root `.env` | `OnDealV2`. Blank = no deals (outside the mocks) |
| `NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS` | root `.env` | `OnDealIntents`. Blank = no signed swaps |
| `NEXT_PUBLIC_POOL_URL` | root `.env` | The intent pool. Default `http://127.0.0.1:8787` |
| `NEXT_PUBLIC_CHOG_ADDRESS` | root `.env` | The Chog collection. Default MockChog `0x220a…26e4` |
| `NEXT_PUBLIC_MOCK_ERC20_ADDRESS`, `NEXT_PUBLIC_KNOWN_COLLECTIONS` | root `.env` | Optional: test ERC-20, and collections the NFT picker lists first |
| `NEXT_PUBLIC_PRIVY_APP_ID` | root `.env` | Privy sign-in. Blank = injected wallet only |
| `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS` | root `.env` | `true` = social sign-in also creates an embedded wallet. Off by default |
| `NEXT_PUBLIC_DEMO_DEALS`, `NEXT_PUBLIC_DEMO_CLUBS` | root `.env` | Development mocks, on unless `false`; never in production |
| `NEXT_PUBLIC_DEMO_CREATE` | root `.env` | `true` = preview the wallet-gated create form with a stand-in catalog (development only) |
| `PRIVY_APP_SECRET` | `web/.env.local` | Server-side Privy: profiles, handle lookup, access tokens |
| `PRIVY_WEBHOOK_SIGNING_SECRET` | `web/.env.local` | Verifies `POST /api/webhooks/privy` ([ADR 0013](../docs/adr/0013-privy-webhooks.md)) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `web/.env.local` | The store (or `KV_REST_API_URL` / `_TOKEN` from the Vercel integration) |
| `CRON_SECRET` | `web/.env.local` | Guards `GET /api/cron/fills`. Blank = the fill watcher is off |
| `FILL_WATCHER_START_BLOCK` | `web/.env.local` | Where the watcher's first run starts. Blank = the current head |
| `CLUB_ADMIN_USER_IDS` | `web/.env.local` | Clubs' app admins (Privy user ids, comma-separated) |

`NEXT_PUBLIC_CHOG_MINTABLE` is still read in `lib/config.ts` but nothing uses it since the mint panel was removed.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests with `node --test` (Node 24+; no extra dependencies, see `test/register.mjs`). 260 tests, about three minutes |
| `npm run abi` | Rebuild contracts with Foundry and regenerate `lib/abi.ts` (needs `forge` on PATH) |

`lib/abi.ts` is committed, so the app builds without Foundry. Rerun `npm run abi` after any contract change.

## Layout

```text
app/         pages: / · /deals · /create · /v2/deal/[id] · /intent/[hash] · /history · /clubs ·
             /clubs/[address] · /account · /guide · /guide/clubs
             redirects: /v2/create → /create · /intents → /deals · /intents/new → /create
app/api/     25 routes: deals, cron/fills, fills, activity, state, profile(s), profiles/lookup,
             collection-traits, clubs/…, me/clubs, webhooks/privy
components/  Providers, Header, ConnectButton, DealSheet, Deal*, Chog*, Tx*, create/, Page helpers, artwork
hooks/       useDealBook, useDealsV2, useDealV2, usePool, useFills, useNotifications, useTxFlow, useSignFlow, …
lib/         abi (generated), config, wagmi, contracts, dealsV2, dealBook, dealFiltersV2, intents, errors, metadata, format
lib/server/  store (Upstash or in-memory), dealBook, fillWatcher, fills, activity, Clubs, privy, privyWebhook, handleLookup
```

## Notes

- Deals are read from storage (`tradeCount` + multicall `getTrade`), not event logs, because the public RPC caps `eth_getLogs` at 100 blocks ([ADR 0004](../docs/adr/0004-read-deals-from-storage.md)). The server keeps the whole book in memory and `GET /api/deals` answers a searched, filtered page ([ADR 0020](../docs/adr/0020-server-side-deal-book.md)).
- `GET /api/cron/fills` (with `Authorization: Bearer <CRON_SECRET>`) follows the chain in 100-block chunks and records fills and Club activity the app never saw ([ADR 0019](../docs/adr/0019-fill-watcher.md)). Call it from a scheduler every minute or so.
- Every write goes through `useTxFlow`: switch chain → simulate → estimate gas (+10%, since Monad bills the limit) → sign → receipt → refetch.
- The home page's swap art (`components/ChogArt.tsx`) uses Angel Chog #1159 and Devil Chog #1376 in board-style white frames. `PinnedChog` (a collage) is not used.
- Clubs (`/clubs`) need the Upstash store and Privy sign-in (`UPSTASH_REDIS_REST_*`, `PRIVY_APP_SECRET`); without them they are read-only (outside production, the in-memory store stands in). Set `CLUB_ADMIN_USER_IDS` (Privy user ids, comma-separated) to name the app admins. A new Club is a `verified` entry in `data/assets.json`; `npm test` covers the logic. Spec: [docs/09-clubs.md](../docs/09-clubs.md).
- `AGENTS.md` / `CLAUDE.md` come from create-next-app. They point coding agents at the bundled Next 16 docs in `node_modules/next/dist/docs/`.
