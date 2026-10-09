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

A Next.js app reads deals from contract storage and keeps Club data, posts and profiles
in Upstash Redis. It finds settled swaps in the chain's logs with Envio HyperSync (below).
A small matcher service pools signed swaps and settles pairs and rings of up to four.
Three contracts hold the money, and none depends on a Club.

```text
Browser (Next.js, wagmi + viem, Privy) ──► Monad: DeClubEscrow  (locked swaps)
        │                                         DeClubIntents (signed swaps)
        ├──► Next.js API ──► Upstash Redis        DeClubRewards (Merkle claims)
        │    (Clubs, posts, profiles, epoch builder, fill watcher)
        │         └──► Envio HyperSync (which txs to read) ──► Monad node (receipts)
        └──► Matcher (HTTP + SQLite) ──► settle(cycle, signatures)
```

### Envio HyperSync

The public Monad RPC answers `eth_getLogs` for only 100 blocks at a time, so following a
week of swaps from logs isn't practical. HyperSync answers any block range in a few queries.
We use its Node client in two places:

- **Activity feed and Club stats.** A cron (`/api/cron/fills`) asks HyperSync for every
  transaction that created or filled a deal on our contracts, then reads
  each receipt from a Monad node and records the swap. HyperSync only says where to look;
  nothing is recorded on its word. If it doesn't answer, the run falls back to the node's
  own log scan. Code: [`hypersyncScan.ts`](web/lib/server/hypersyncScan.ts),
  [`fillWatcher.ts`](web/lib/server/fillWatcher.ts). Why: [ADR 0051](docs/adr/0051-hypersync-for-the-fill-watcher.md).
- **Rewards check.** Before a Safe signs a weekly rewards root, `npm run rewards:verify`
  totals every `FeeCharged` log in the epoch's window and fails if the Clubs were credited
  more fees than the contracts charged. Code: [`feeCheck.ts`](web/lib/server/feeCheck.ts).
  Why: [ADR 0052](docs/adr/0052-check-epoch-fees-against-fee-logs.md).

Set `ENVIO_API_TOKEN` (server-side) to turn both on. Without it the watcher scans the node
100 blocks at a time and the fee check is skipped.

The full diagram, components and trade-offs are in [docs/02-architecture.md](docs/02-architecture.md),
the contracts in [docs/03-contract-design.md](docs/03-contract-design.md) and the threat
model in [docs/04-security.md](docs/04-security.md).

## Technology stack

| Layer | Technology |
| --- | --- |
| Contracts | Solidity 0.8.28 (EVM `prague`), Foundry, OpenZeppelin; fuzz tests, Slither and Halmos checks |
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Chain access | wagmi 3, viem 2, TanStack Query; Alchemy RPC; Envio HyperSync for log scans on the server |
| Identity | Privy (sign-in, linked X and Discord handles, webhooks via svix), EIP-712 signatures |
| Data | Upstash Redis for Clubs, posts, follows and profiles; the chain for deals and holdings |
| Matcher | Node.js 24 with built-in SQLite, viem |
| Rewards | Merkle distributor, weekly epochs built by `npm run rewards:epoch` |
| Tests | Foundry, Node test runner, end-to-end checks on a local Anvil chain |

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
