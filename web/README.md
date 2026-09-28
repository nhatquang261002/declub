# web/

The Chog Swap frontend: Next.js 16 (App Router) · wagmi 3 · viem · Tailwind 4. It has no backend and reads and writes Monad testnet directly.

**Status:** Phase 2 UI implementation complete. Open Trades, My Chogs, Create, Trade Detail and History are wired; testnet rehearsal remains.

The official Chog logo set is kept in [`public/brand/`](./public/brand/). The header uses the
white horizontal lockup, and the face mark is used for the browser icon.

Sample community NFT artwork is kept in [`public/art/chogs/`](./public/art/chogs/) and is used
as rotating pinned artwork on the trades page.

## Run

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

No setup is needed. Addresses default to the Phase 1 testnet deployment. To point at other contracts, set the `NEXT_PUBLIC_*` values in the **repo-root** `.env` (see [`.env.example`](../.env.example)). `next.config.ts` loads that file, and `web/.env.local` overrides it.

You need an injected wallet (MetaMask, Rabby, …) on Monad testnet (chain 10143) with some test MON. The **My Chogs** page mints MockChogs for demo wallets.

For a wallet-free UI review, set `NEXT_PUBLIC_DEMO_TRADES=true`. Sample trades replace the live trade list while enabled; leave it disabled for normal testnet use.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run abi` | Rebuild contracts with Foundry and regenerate `lib/abi.ts` (needs `forge` on PATH) |

`lib/abi.ts` is committed, so the app builds without Foundry. Rerun `npm run abi` after any contract change.

## Layout

```text
app/         routes: / · /my-chogs · /create · /trade/[id] · /history · /guide
components/  Providers, Header, ConnectButton, Chog*, Trade*, Tx*, Page helpers, artwork
hooks/       useTrades, useTrade, useChogs, useChogApproval, useTxFlow, useLocalFills, useNow
lib/         abi (generated), config, wagmi, contracts, trades, errors, metadata, format
```

## Notes

- Trades are read from storage (`tradeCount` + multicall `getTrade`), not event logs, because the public RPC caps `eth_getLogs` at 100 blocks ([ADR 0004](../docs/adr/0004-read-trades-from-storage.md)).
- Every write goes through `useTxFlow`: switch chain → simulate → estimate gas (+10%, since Monad bills the limit) → sign → receipt → refetch.
- The trades page uses the supplied NFT artwork as a randomized pinboard collage; the hero swap art uses Angel Chog #1159 and Devil Chog #1376 in board-style white frames.
- `AGENTS.md` / `CLAUDE.md` come from create-next-app. They point coding agents at the bundled Next 16 docs in `node_modules/next/dist/docs/`.
