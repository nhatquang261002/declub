# web/

The On Deal frontend: Next.js 16 (App Router) · wagmi 3 · viem · Tailwind 4. It has no backend and reads and writes Monad testnet directly.

**Status:** Phase 2 UI implementation complete. Open Deals, Create, Deal Detail and the wallet-free History preview are wired; testnet rehearsal remains.

The official Chog logo set is kept in [`public/brand/`](./public/brand/). The header uses the
white horizontal lockup, and the face mark is used for the browser icon.

Sample community NFT artwork is kept in [`public/art/chogs/`](./public/art/chogs/) and is used
as rotating pinned artwork on the deals page.

## Run

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

No setup is needed. Addresses default to the Phase 1 testnet deployment. To point at other contracts, set the `NEXT_PUBLIC_*` values in the **repo-root** `.env` (see [`.env.example`](../.env.example)). `next.config.ts` loads that file, and `web/.env.local` overrides it.

You need an injected wallet (MetaMask, Rabby, …) on Monad testnet (chain 10143) with some test MON. The **My Chogs** page mints MockChogs for demo wallets.

For a wallet-free UI review, set `NEXT_PUBLIC_DEMO_DEALS=true`. Sample deals replace the live deal list while enabled; leave it disabled for normal testnet use. The History page currently uses this preview data without requiring a connected wallet.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests with `node --test` (Node 24+; no extra dependencies, see `test/register.mjs`) |
| `npm run abi` | Rebuild contracts with Foundry and regenerate `lib/abi.ts` (needs `forge` on PATH) |

`lib/abi.ts` is committed, so the app builds without Foundry. Rerun `npm run abi` after any contract change.

## Layout

```text
app/         routes: / · /my-chogs · /create · /deal/[id] · /history · /clubs · /guide
components/  Providers, Header, ConnectButton, Chog*, Deal*, Tx*, Page helpers, artwork
hooks/       useDeals, useDeal, useChogs, useChogApproval, useTxFlow, useLocalFills, useNow
lib/         abi (generated), config, wagmi, contracts, deals, errors, metadata, format
```

## Notes

- Deals are read from storage (`tradeCount` + multicall `getTrade`), not event logs, because the public RPC caps `eth_getLogs` at 100 blocks ([ADR 0004](../docs/adr/0004-read-deals-from-storage.md)).
- Every write goes through `useTxFlow`: switch chain → simulate → estimate gas (+10%, since Monad bills the limit) → sign → receipt → refetch.
- The deals page uses the supplied NFT artwork as a randomized pinboard collage; the hero swap art uses Angel Chog #1159 and Devil Chog #1376 in board-style white frames.
- Clubs (`/clubs`) need the Upstash store and Privy sign-in (`UPSTASH_REDIS_REST_*`, `PRIVY_APP_SECRET`); without them they are read-only. Set `CLUB_ADMIN_USER_IDS` (Privy user ids, comma-separated) to name the app admins. A new Club is a `verified` entry in `data/assets.json`; `npm test` covers the logic. Spec: [docs/09-clubs.md](../docs/09-clubs.md).
- `AGENTS.md` / `CLAUDE.md` come from create-next-app. They point coding agents at the bundled Next 16 docs in `node_modules/next/dist/docs/`.
