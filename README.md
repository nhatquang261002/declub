<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/logo-on-dark.svg">
    <img src="brand/logo/logo-on-light.svg" alt="De(al) Club" height="56">
  </picture>
</p>

# De(al) Club

> **Your community's home and market, owned by its members.**

Docs: [index](docs/README.md) · [product spec](docs/01-product-spec.md) · [user guide](docs/07-user-guide.md) · [Clubs](docs/09-clubs.md) · [roadmap](docs/06-roadmap.md)

## The problem

NFT communities create a lot of value, but very little of it comes back to them. The people who generate it are rarely the ones who capture it.

- **Activity goes unpaid.** The Holders who post, welcome newcomers, answer questions and keep a project alive earn nothing for it. Their only reward is a Discord role.
- **The conversation belongs to a platform.** A community's posts, followers and history live on Discord and X, which can rank, bury or delete them, and none of the value goes back to the people who wrote them.
- **The fees leave the community.** Holders trade with each other every day, and the marketplace keeps the whole trading fee. Nothing goes back to the collection whose community made the market.
- **Owners have no way to fund the community** besides launching a token or running another sale.
- **Rewarding activity usually backfires.** When a project pays for posts or volume, it attracts bots, like rings and wash trading, so the real members are drowned out.
- **Swapping NFTs is slow and risky.** Marketplaces sell NFTs for a price, they don't swap them. Swapping in DMs means agreeing who sends first, which is where scams happen.
- **The OTC market takes a lot to be trusted.** OTC deals take at least 5-10% of the deal from the trader just to have a middleman for your deal to happen.

The question behind DeClub: when a community creates the value, who captures it?

## The solution

DeClub gives every verified Monad NFT collection a Club: an open Board signed by its members, a ranking of who the community backs, weekly rewards in MON, and its own swap market whose fees pay for those rewards.

DeClub is a home for an NFT community first. The market is what pays for it.

### 1. An open social graph the members own

Each Club has a Board for posts, replies, likes and pins. Posts and follows are signed by the member's wallet and can be exported in full, so the social graph belongs to the community, not a platform, and nobody can lock it in or delete it. The community runs its own Club: the Owner and Moderators moderate the Board, the Owner sets the reward rules, and Holders vote on challenge winners. A cross-Club Timeline lets anyone discover other communities.

### 2. Competitive feeds

Readers choose how the feed is ordered (Newest, Most active, Holders, Following). Every order is a simple public function over public data, so any other app can compete to rank the same posts better.

### 3. Attention that pays the people who give it

Points come mostly from other members backing you, not from how much you post. Each Holder gets a weekly voice, weighted by the NFTs they hold, and spends it by liking and replying to posts in their Club. Curation is paid too: members earn a little for backing others. Verified outside accounts get a small voice, so newcomers can join in. The system is built to be hard to game:

- holdings are averaged over the week, so buying just before the snapshot doesn't work,
- mutual backing between the same two members counts for less,
- outside voices and swap points are capped, and repeat swaps with the same person count less,
- payouts follow the NFTs a member actually holds, so a farm of fake accounts earns roughly what its NFTs would anyway,
- who backed whom is published every week, so anyone can audit it.

Each Club's Owner programs its incentives within protocol limits: pay every active Holder, only the most active, or a share for members without NFTs, and ban abusers from rewards.

Swap fees are one source of rewards. An Owner or a sponsor can put more in any week, run challenges with incentives, and grow the community.

### 4. A real stake, funded by the community's own trades

Each completed swap in the Club pays a small fee per NFT moved. Every week:

- 50% goes to the Club's active Holders,
- 25% goes to the Club fund, which the Owner collects,
- 25% goes to the protocol.

Payouts are published as a Merkle root on DeClubRewards, so anyone can check their share on chain and claim it in one transaction.

A project, a partner or the Owner can sponsor a week: the MON joins the Holders' pool, with the sponsor's name on the Club's page and its weekly recap, so a Club with little trading can still reward its community.

### 5. The engine: a trustless swap market

Members swap NFT for NFT, add MON on either side, or ask for any NFT with the traits they want. Every swap settles atomically on chain, so nobody sends first and nobody has to trust the other side. Two modes:

- **Locked swaps (DeClubEscrow):** the maker locks their side and the taker completes it in one transaction.
- **Signed swaps (DeClubIntents):** wallets sign what they want to give and get, and a matcher settles pairs, or rings of up to four people, in one transaction.

### 6. Challenges

The Owner can set the Club a task, like "post your best fan art on X", and a sponsor can back the week it runs in. Members enter with their own X post, and winners are picked by likes, a Holder vote, the Owner, a verifiable on-chain raffle, first in, or everyone who qualifies. Prizes can be points, trophies, NFT or token prizes, or a pinned post.

### 7. A new kind of creator fee

An Owner claims their Club by proving on chain that they own the collection's contract, then collects the Club fund each week: a cut of every swap their community makes. A royalty pays the creator when an NFT is resold; the loyalty fee pays them while the community keeps trading together. No token, no sale, no extra mint.

### 8. Safety built in

Trust badges and lookalike checks flag fake or copycat collections. Users confirm the contract addresses before accepting a swap, can see and revoke their token approvals on one page, and get a warning on long-lived signatures. Before a payout is signed, a verification script checks it.

### Why Monad

DeClub turns a swap into a social action that happens many times a week: approve, fill, claim. Each step has to confirm fast and cost little. Monad is EVM-compatible, so the contracts are plain Solidity and any wallet works. With 800ms finality and 10,000 TPS, a multi-step swap feels like one click, which closes the gap that has made onchain social feel clunky. Rewards are paid in the same MON the fees were paid in.

## What makes it useful

**For Holders:** holding and taking part finally earns something. When you post, reply, back other members and trade inside your Club, you get a real share of the fees your community generates, paid in MON and checkable on chain. Your posts and followers belong to your wallet, not to a platform.

**For Owners:** a ready-made home for the community, with its own Board, moderation tools, challenges, member rankings and market, plus the Club fund, and sponsors and challenges to fund and grow the community, all without launching a token. Rewards favour Holders who stay and engage over people who flip, which is what a project needs to survive after mint.

**For traders:** NFT-for-NFT swaps, bundles, trait requests and multi-party rings, all without trusting a stranger or sending first. This is a market that floor-price marketplaces don't offer.

**For the ecosystem:** DeClub doesn't ask anyone to leave Discord, X or their usual marketplace. It adds a layer those platforms can't offer, because their business model is keeping the value. There's a built-in growth loop: Holders share their Club on X → visitors see an active Club with real conversation and trades → they join, hold, post and swap → swap fees grow the reward pool → Holders earn more and share more. Every rewarded Holder is also marketing their Club.

What sets it apart:

- Members own what they create: their posts, their social graph and a share of the value.
- Rewards are tied to real engagement between members and to real NFT ownership, so they are hard to farm.
- Everything that matters can be verified: swaps settle on chain, payouts are Merkle claims, posts are wallet-signed, and the backing data is public.
- No new token and no speculation. Rewards come from real fees on real swaps.

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
not the demo world's conversation. **fill:** the hosted demo URL, which has all of it.

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
