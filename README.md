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

The protocol, web app, matcher and rewards flow are implemented. `DeClubEscrow`
and `DeClubRewards` are deployed on Monad testnet. `DeClubIntents` is not yet,
so signed swaps don't work on testnet until it is. The remaining release work is
that deployment, a manual click-through with real wallets and a rewards epoch
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
| `DeClubEscrow` | Deployed for the [demo world](docs/12-demo.md) (fixed 0.05 MON fee per side) |
| `DeClubRewards` | Deployed for the demo world, the bank wallet is the operator |
| `DeClubIntents` | **Not deployed.** The address in `.env` is the retired `OnDealIntents`, which signs with an older EIP-712 domain, so the app's signed swaps fail against it |

Deploy `DeClubIntents` with the instructions in
[contracts/script/README.md](contracts/script/README.md), then put the printed
address and block in the root `.env`. The addresses are in the broadcast records
under `contracts/broadcast/`.

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
