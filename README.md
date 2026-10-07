# De(al) Club

> **Your community's market, owned by its members.**

DeClub gives each verified Monad NFT collection a Club: a market, a signed
conversation, member rankings and rewards funded by completed swaps.

## Key points

DeClub is an NFT marketplace that each community owns, built around one question:
when a community creates the value, who captures it?

- **A more fun way to trade.** Swap NFT for NFT, with MON on either side, or ask
  for any NFT with the traits you want. Every swap settles atomically, so
  nobody has to trust the other side or send first.
- **Your own market for your community.** Every verified Monad NFT collection
  gets a Club with its own market, board and ranked members, run by an Owner
  and Moderators.
- **Participation turns into a stake.** Each week, 50% of the fees a Club's swaps
  pay goes to its Holders with at least 10 points that week, 25% to the Club fund the Owner collects and 25% to the
  protocol. Points come mostly from others backing your posts and replies: each
  Holder shares out a weekly voice, weighted by the NFTs they hold, over what they
  like and answer in their Club, and any verified account adds a small voice that
  works across Clubs. Outside voices are capped, holdings are averaged over the
  week, and every Holder at the points floor is paid, so fake accounts and like
  rings earn about what their NFTs would, and every payout is a Merkle claim anyone
  can check on chain.
- **The social graph is yours.** Posts and follows are signed by the member's
  wallet and exported in full, so a Club's conversation can't be locked in or
  deleted by a platform.
- **The feed is a choice.** The Board is ordered by a lens the reader picks
  (Newest, Most active, Holders, Following). A lens is a pure function over
  public data, so another app can rank the same posts its own way. There is no
  registry of third-party lenses yet.
- **Governance is next.** Holder votes for Moderators and Club-fund grants are
  planned but not built ([roadmap](docs/06-roadmap.md)). Today the Owner decides.

The application supports:

- locked swaps through `DeClubEscrow`;
- signed swaps through `DeClubIntents`;
- Club posts, follows, moderation and Momentum;
- weekly Holder and Club-fund rewards through `DeClubRewards`.

See the [product spec](docs/01-product-spec.md), [user guide](docs/07-user-guide.md)
and [Club specification](docs/09-clubs.md) for details.

## The problem and who it is for

NFT communities do their work in Discord and on X, but the value that work creates
leaves: a marketplace keeps the trading fee, a Discord server can be banned or deleted,
and Holders who post, welcome newcomers and trade with each other earn nothing for it.
Swapping with a stranger still means someone has to send first.

DeClub is for three people around a Monad NFT collection: the **Owner** who wants Holders
who stay and a way to fund the community, the **Holder** who wants something back for
holding and talking, and the **Trader** who wants an NFT-for-NFT swap with no one to
trust. See [docs/13-go-to-market.md](docs/13-go-to-market.md).

## Architecture

A Next.js app reads the chain directly (no indexer) and keeps Club data, posts and
profiles in Upstash Redis. A small matcher service pools signed swaps and settles pairs
and rings of up to four. Three contracts hold the money, and none depends on a Club.

```text
Browser (Next.js, wagmi + viem, Privy) ──► Monad: DeClubEscrow  (locked swaps)
        │                                         DeClubIntents (signed swaps)
        ├──► Next.js API ──► Upstash Redis        DeClubRewards (Merkle claims)
        │    (Clubs, posts, profiles, epoch builder, fill watcher)
        └──► Matcher (HTTP + SQLite) ──► settle(cycle, signatures)
```

The full diagram, components and trade-offs are in [docs/02-architecture.md](docs/02-architecture.md),
the contracts in [docs/03-contract-design.md](docs/03-contract-design.md) and the threat
model in [docs/04-security.md](docs/04-security.md).

## Technology stack

| Layer | Technology |
| --- | --- |
| Contracts | Solidity 0.8.28 (EVM `prague`), Foundry, OpenZeppelin; fuzz tests, Slither and Halmos checks |
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Chain access | wagmi 3, viem 2, TanStack Query |
| Identity | Privy (sign-in, linked X and Discord handles, webhooks via svix), EIP-712 signatures |
| Data | Upstash Redis for Clubs, posts, follows and profiles; the chain for deals and holdings |
| Matcher | Node.js 24 with built-in SQLite, viem |
| Rewards | Merkle distributor, weekly epochs built by `npm run rewards:epoch` |
| Tests | Foundry, Node test runner, end-to-end checks on a local Anvil chain |

## Monad integration

DeClub runs on Monad testnet (chain `10143`); the same code builds for mainnet (`143`) as a
[flavor](#flavors-testnet-and-mainnet), but nothing is deployed there.

- **`DeClubEscrow`** settles a swap of NFTs, tokens and MON between two wallets in one
  atomic transaction, and takes a fee in MON for each NFT a side moves.
- **`DeClubRewards`** is a Merkle distributor. Each week the operator publishes one root of
  everyone's share of the fees, and a Holder claims in one transaction.
- **Why Monad.** The product turns a swap into a social action that happens many times a
  week, with approval, fill and claim steps, so every step has to confirm fast and cost
  little. Monad is EVM-compatible, so the contracts are plain Solidity and any wallet works,
  and its fast blocks and low gas make a three-step swap feel like one click. Rewards are
  paid in the native MON the fees were paid in.
- Wallets sign messages (EIP-712 posts, follows and swaps) with the same account that holds
  the NFTs, so identity and ownership are the same address.

### Contracts on Monad testnet

| Contract | Address | Deployment transaction |
| --- | --- | --- |
| `DeClubEscrow` | `0xcD0f7e49E636a040E7b03D5592334005e429893F` | `0x724b529367d26487c1a745aee8af6f3cf30034b02d8952994e57bb5ccfd12bd0` |
| `DeClubIntents` | `0x57E02b63dFDEd9d5cF327C20328227Cf6877dE55` | `0x9d4e9ba380f94ee762485c5836175ef283a1b2f7ee936a51faa112c907236200` |
| `MockWMON` (intents fee token) | `0x211Db89bDdAF9E7e945d6039AF5970C8642E9b96` | `0xbe91b1fa176113f7977cc7e8ce2d653c8eae5146818a7125e110251281e235cb` |
| `DeClubRewards` | `0xfEC46AF05cAFe35B6b715982bCAf1DD02bb73E9a` | `0x16f552b69fb56e006dd35163a344dac061064df6dd2908c3c4af6423aea1397c` |
| Chog Genesis mirror (demo) | `0xadca7be2cdf247a388a6fb4b19fdf0b436ad2584` | `0x0b7ef957000870b3d6b39f7d91c0e1221c3c2c2bd5213fcfc72d2e034ff04406` |
| skrumpeys mirror (demo) | `0xa2545c8c2907cfdaccfc43774a04ffa5c3d174c2` | `0x69ee93540db7df39ba41436d2cd8fbab913502e799098fc8e004165fab61392d` |
| r3tards mirror (demo) | `0x816f53ac5f57f7a69e0a9467d945e5778a864da8` | `0xe91895e88a47ffe661aca82a381aa9144a109d4e5c8e3ff600362c94d834bfdd` |

Look any of them up on <https://testnet.monadvision.com>. The mirrors are testnet copies of
three mainnet collections, so the demo has art and holders to show ([docs/12-demo.md](docs/12-demo.md)).
The full records are in `contracts/broadcast/`.

## Status

The protocol, web app, matcher and rewards flow are implemented. `DeClubEscrow`,
`DeClubIntents` and `DeClubRewards` are deployed on Monad testnet. The remaining
release work is a manual click-through with real wallets and a rewards epoch
run end to end. See the [roadmap](docs/06-roadmap.md) and
[test plan](docs/11-test-plan.md).

## Privy

Privy provides optional sign-in, linked social handles, multi-wallet identity,
Club membership and server authorization. Without a Privy app ID, the web app
uses an injected wallet. See [docs/10-privy.md](docs/10-privy.md).

## Deployments

On Monad testnet (chain `10143`):

| Contract | State |
| --- | --- |
| `DeClubEscrow` | Deployed 2026-10-07 with the per-NFT fee ([ADR 0033](docs/adr/0033-fee-per-nft.md)): 0.05 MON per NFT a side moves, ceiling 0.2 MON, fixed, paid to the demo bank |
| `DeClubRewards` | Deployed for the demo world, the bank wallet is the operator |
| `DeClubIntents` | Deployed 2026-10-07 with the same fee in `MockWMON` (testnet has no canonical WMON), fixed, paid to the demo bank. Run the matcher against it (`matcher/README.md`) |

The addresses and deployment blocks are in the root `.env` and in the broadcast records
under `contracts/broadcast/`. The demo's ten swaps were rerun on this escrow
([docs/12-demo.md](docs/12-demo.md)). The previous escrow (`0xb8bB…148f`) is retired, but the Club
activity recorded from it is still in the store.

## Repository map

| Path | Purpose |
| --- | --- |
| [`contracts/`](contracts/) | Solidity contracts, tests and deployment scripts |
| [`web/`](web/) | Next.js application |
| [`matcher/`](matcher/) | Signed-intent pool and matcher |
| [`e2e/`](e2e/) | Pre-mainnet contract and web checks |
| [`docs/`](docs/) | Product, architecture, security and operations docs |

## Quickstart

### Toolchain

- Node.js 24+
- Foundry
- Anvil for local end-to-end tests

Install dependencies:

```bash
cd web && npm install
cd ../matcher && npm install
cd ../e2e && npm install
```

Copy `.env.example` to `.env` and set the required addresses and secrets.

### Try it against the testnet deployment

The on-chain parts need no secrets. Put these in the root `.env`:

```bash
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS=0xb8bB420CFf0dFB781cD6c1cF1569B137EFc3148f
NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS=0xfEC46AF05cAFe35B6b715982bCAf1DD02bb73E9a
NEXT_PUBLIC_CHOG_ADDRESS=0xadca7be2cdf247a388a6fb4b19fdf0b436ad2584
NEXT_PUBLIC_IPFS_GATEWAY=https://ipfs.filebase.io/ipfs/
```

Then `cd web && npm install && npm run dev`, connect a wallet on Monad testnet and
get test MON from a Monad testnet faucet. Swaps and claims are on-chain transactions.

Posts, follows, profiles and Club membership are stored in Upstash Redis and sign-in
uses Privy, so a local run without `UPSTASH_REDIS_REST_URL`/`_TOKEN` and
`NEXT_PUBLIC_PRIVY_APP_ID`/`PRIVY_APP_SECRET` (see `.env.example`) shows the market but
not the demo world's conversation. Signed swaps (`DeClubIntents`) are not deployed on
testnet. **fill:** the hosted demo URL, which has all of it.

### Run the web app

```bash
cd web
npm run dev
```

Open <http://localhost:3000>. The app uses Monad testnet by default.

### Flavors: testnet and mainnet

One codebase, two flavors. Each has its own chain, env file, build folder, port and storage, so
both run side by side.

| | testnet | mainnet |
|---|---|---|
| Chain | 10143 | 143 |
| Env | `.env` (as before), or `.env.testnet` | `.env.mainnet`, from [`.env.mainnet.example`](.env.mainnet.example) |
| Web | `npm run dev:testnet`, port 3000 (`dev` still works) | `npm run dev:mainnet`, port 3001 |
| Build and serve | `build:testnet`, `start:testnet` | `build:mainnet`, `start:mainnet` (build folder `web/.next-mainnet`) |
| Matcher | `npm start`, port 8787 | `npm run start:mainnet` in `matcher/`, port 8788 |

The mainnet flavor reads only `.env.mainnet` (and `web/.env.mainnet.local` for server secrets). Every
key the testnet `.env` and `web/.env.local` set is blanked, so a testnet RPC, key or database can't
reach it. It refuses to start with a mock token, `REWARDS_OPERATOR_KEY`, a mintable Chog, a testnet
RPC, a missing Chog address or an Upstash database shared with testnet. The pages say which network
they're on (`web/lib/network.ts`).

To host both, make two projects from this repo with the same build command and different
environments: the testnet one with the testnet values, the mainnet one with `.env.mainnet.example`'s
keys. Set `NEXT_PUBLIC_CHAIN_ID=143` there; the flavor scripts do it locally. Publish mainnet
epochs from the Safe: `npm run rewards:epoch:mainnet` builds without `--publish`.

Before mainnet can go live, it needs its contracts deployed (`DeployEscrow`, `DeployIntents`,
`DeployRewards` with Safes; see [docs/11-test-plan.md](docs/11-test-plan.md#6-mainnet)) and mainnet
entries in `web/data/assets.json`. The file only lists testnet assets today, so mainnet starts with
every asset unverified.

### Host the testnet app on Vercel

The free (Hobby) plan and the default `<project>.vercel.app` URL are enough for testnet.

1. Import the repo in Vercel with **Root Directory** `web` and the default build (`next build`).
2. `cd web && vercel link`, then `scripts/vercel-env.sh --dry-run` and `scripts/vercel-env.sh`. It pushes
   an allowlist of the root `.env` and `web/.env.local` to Production, never the deploy or matcher
   keys, and generates a `CRON_SECRET` if there is none. Redeploy afterwards: `NEXT_PUBLIC_*` values
   are baked in at build time.
3. In the Privy dashboard, add `https://<project>.vercel.app` to the app's allowed origins.
4. The fill watcher ([ADR 0019](docs/adr/0019-fill-watcher.md)) needs something to call
   `/api/cron/fills`. Hobby crons run once a day at most, so
   [`.github/workflows/fill-watcher.yml`](.github/workflows/fill-watcher.yml) does it every 5
   minutes. Add the repository secrets `SITE_URL` (the Vercel URL) and `CRON_SECRET` (the value Vercel has).

Signed swaps need the matcher, which can't run on Vercel (a long-running process with a sqlite file).
Run it somewhere with a disk and set `NEXT_PUBLIC_POOL_URL` to its HTTPS address; with
`NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` blank the app hides signed swaps instead. Vercel's Hobby plan is
for non-commercial use, so move to Pro before mainnet.

### Run checks

```bash
./scripts/test-all.sh
```

Useful focused commands:

```bash
cd contracts && forge test
cd matcher && npm test
cd web && npm test && npm run typecheck && npm run lint
```

### Rewards

Build the next finished rewards epoch from `web/`:

```bash
npm run rewards:epoch -- --publish
```

See [docs/12-demo.md](docs/12-demo.md) for the complete demo setup and
[docs/06-roadmap.md](docs/06-roadmap.md) for current release gates.
