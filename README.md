# De(al) Club

> **Your community's market, owned by its members.**

DeClub gives each verified Monad NFT collection a Club: a market, a signed
conversation, member rankings and rewards funded by completed swaps.

The application supports:

- locked swaps through `DeClubEscrow`;
- signed swaps through `DeClubIntents`;
- Club posts, follows, moderation and Momentum;
- weekly Holder and Club-fund rewards through `DeClubRewards`.

See the [product spec](docs/01-product-spec.md), [user guide](docs/07-user-guide.md)
and [Club specification](docs/09-clubs.md) for details.

## Status

The protocol, web app, matcher and rewards flow are implemented. The remaining
release work is a fresh testnet deployment of the current DeClub contracts and
a manual click-through with real wallets. See the [roadmap](docs/06-roadmap.md)
and [test plan](docs/11-test-plan.md).

## Privy

Privy provides optional sign-in, linked social handles, multi-wallet identity,
Club membership and server authorization. Without a Privy app ID, the web app
uses an injected wallet. See [docs/10-privy.md](docs/10-privy.md).

## Deployments

The current DeClub contracts are not deployed to testnet yet. Deploy them with
the instructions in [contracts/script/README.md](contracts/script/README.md),
then put the printed addresses in the root `.env`.

Existing testnet deployments use retired contract names and domains. Do not
use them with the current app.

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

### Run the web app

```bash
cd web
npm run dev
```

Open <http://localhost:3000>. The app uses Monad testnet by default.

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
