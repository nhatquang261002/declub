# De(al) Club

> **Your community's market, owned by its members.**
>
> *Every Monad NFT collection gets a Club, and its memecoin comes with it. Members trade inside it, talk in posts they sign and own, and Holders earn a share of the fees their Club's swaps pay.*

DeClub (written De(al) Club) turns the people around an asset into the owners of its market ([ADR 0021](docs/adr/0021-declub-pivot.md)):

| | What |
|---|---|
| **Gather** | A Club for each verified NFT collection (its memecoin joins it): its Market, a Board, Members ranked by Momentum, Holder badges, an Owner and Moderators ([09 · Clubs](docs/09-clubs.md)). |
| **Trade** | Members swap inside the Club, through escrow or by signing, with no trust between them. Every completed swap pays a small flat fee per side. |
| **Own the market** | Each week, 40% of the fees a Club's swaps paid goes to its Holders, by holdings, and 20% to its Club fund, which the Owner collects, claimed on chain from `DeClubRewards` ([ADR 0022](docs/adr/0022-club-rewards.md)). |
| **Own the conversation** | Posts and follows are signed by the member's wallet and exported in full; the reader picks how the Board is ordered ([ADR 0023](docs/adr/0023-signed-posts-and-lenses.md)). |

Faking volume to farm rewards loses money: each side of a swap pays the whole fee, and at most 60% of it comes back, shared with every Holder.

Underneath is the trading engine. Two people swap any ERC-721, ERC-20 and MON, in any mix, through an on-chain escrow (`DeClubEscrow`) that settles atomically:

```text
Alice: Chog #421           ⇄           Bob: Chog #812 + 50 mUSD

createTrade     → Alice's #421 locked in DeClubEscrow
fillTrade       → one tx: #812 + 50 mUSD → Alice, #421 → Bob
cancel / expiry → #421 back to Alice. Nothing is ever stuck.
```

A locked deal can ask for exact assets, for any NFT with given traits ("any Chog with a Crown"), or for offers. A **signed swap** locks nothing: each side signs what it gives and wants, and a matcher settles pairs and rings of up to four through `DeClubIntents`. The fee admin can change the fee within a ceiling fixed at deploy ([ADR 0018](docs/adr/0018-adjustable-protocol-fee.md)).

## Status

- **Protocol: built.** `DeClubEscrow`, `DeClubIntents`, the shared `FeeAdmin`, `DeClubRewards` and the mocks, with 431 Foundry tests passing in 38 suites (unit, fuzz, invariant, including invariants against hostile NFT collections and underfunded reward roots), a Halmos proof that every pair and 3-ring pays every maker's `want`, 100% coverage of `DeClubRewards`, and Slither triaged on every contract ([04 · Security](docs/04-security.md)).
- **Rewards and signed social: built.** The epoch builder (`npm run rewards:epoch` in `web/`), the Rewards tab and claims, signed posts and follows with public exports, and feed lenses. Holders' own X posts about their Club count in Momentum and in an activity bonus of up to 50% on their Holder share, by number; counting their engagement is in development and deferred ([ADR 0024](docs/adr/0024-x-posts-and-the-holder-bonus.md)). The e2e run on anvil takes a real swap's fee through the builder to claims on chain (RW-01 to RW-03).
- **App: built.** The Next.js app in [`web/`](web/) has Clubs (Market, Board, Members, Rewards, Manage), the deal list, Create (lock or sign), the deal and signed-swap pages, History, Account (with your rewards), the Guide, notifications and Privy sign-in. The matcher has 110 tests and the web app 340 unit tests.
- **Testnet: to deploy.** Nothing runs under the DeClub names yet: deploy `DeClubEscrow`, `DeClubIntents` and `DeClubRewards` from [`contracts/script/`](contracts/script/README.md). Then a click-through with real wallets.

See the [roadmap](docs/06-roadmap.md).

## Built with Privy

Privy is DeClub's identity layer for Clubs and trading with strangers, not just its sign-in:

- **Verified trader profiles:** a maker's X or Discord handle, read from Privy's linked accounts on the server, shows beside their wallet on every deal.
- **Make a deal for @handle:** type the counterparty's X or Discord handle, and Privy's user lookup finds the wallet to lock the deal to, so nobody pastes an address from a DM.
- **Webhooks** keep those profiles and Club memberships accurate when an account is unlinked, transferred or deleted.
- **One person, many wallets:** link a vault and a hot wallet. Club Holder badges count assets across all of them, and Club roles and bans follow the Privy user, not one wallet.
- **Per-user server state** is authorized by verified Privy access tokens.

Embedded wallets are off by default, because traders bring the wallet that already holds their collection; `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=true` turns them on for social sign-ins. Without `NEXT_PUBLIC_PRIVY_APP_ID` the app falls back to a plain injected-wallet connect. Details, the demo script and setup: [docs/10-privy.md](docs/10-privy.md).

## Deployments: Monad testnet (chain 10143)

Nothing is deployed under the DeClub names yet ([ADR 0021](docs/adr/0021-declub-pivot.md)). Deploy with the scripts in [`contracts/script/`](contracts/script/README.md) and put the printed addresses in the root `.env`.

### Retired deployments

Everything below was deployed before the rename, under the project's earlier names, and is kept as a record. The broadcast records stay under the scripts' old names.

| Contract (as deployed) | Address | Block | Record |
| -------- | ------- | ----- | ------ |
| OnDealV2 (now `DeClubEscrow`) | [`0x0d09747285b1370D2D1E296f8AE55c40bc1a89e9`](https://testnet.monadvision.com/address/0x0d09747285b1370D2D1E296f8AE55c40bc1a89e9) | 68422577 | [`DeployV2 run-latest.json`](contracts/broadcast/DeployV2.s.sol/10143/run-latest.json) |
| OnDealIntents (now `DeClubIntents`; signs with the old domain `("OnDealIntents", "3")`) | [`0x2bfe691efC9D3555876E92C48633D2fA41C88AEB`](https://testnet.monadvision.com/address/0x2bfe691efC9D3555876E92C48633D2fA41C88AEB) | 68422663 | [`DeployIntents run-latest.json`](contracts/broadcast/DeployIntents.s.sol/10143/run-latest.json) |
| MockWMON (fee token) | [`0xB620e96af5B50CB146a8c680BB1dd0965AbdDDe9`](https://testnet.monadvision.com/address/0xB620e96af5B50CB146a8c680BB1dd0965AbdDDe9) | 68422660 | same record as OnDealIntents |
| MockERC20 (mUSD) | [`0xd300f095f456D59AAc122B0100833fE195136F6c`](https://testnet.monadvision.com/address/0xd300f095f456D59AAc122B0100833fE195136F6c) | 66874652 | [`DeployV2 run-1790742069295.json`](contracts/broadcast/DeployV2.s.sol/10143/run-1790742069295.json) |
| Chog collection (ChogGenesisMirror) | [`0x32a325b0640594377d0708ca9081c93da95e1908`](https://testnet.monadvision.com/address/0x32a325b0640594377d0708ca9081c93da95e1908) | 66576933 | [`Deploy run-latest.json`](contracts/broadcast/Deploy.s.sol/10143/run-latest.json) |

The two deal contracts above were deployed on 2026-10-05 with the fee on: 2 MON (WMON for signed swaps) per side, ceiling 8 MON, fee admin `0x7BD8…E920`, recipient `0x06b5…0669` (testnet-only wallets). The mock WMON, mUSD and the Chog mirror can be reused by the DeClub deployment.

Older still, all retired: a later `OnDealV2` at `0x67a4a4ddfab155689ce2ee40c9c2157cea8e68fc` (block 67193827) and the first V2 at `0x8a05…CC75`, without the fee; the deleted v1 escrow, the original `0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298` with `MockChog` `0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4` (blocks 66352698 / 66352681, [`Deploy run-1790581370358.json`](contracts/broadcast/Deploy.s.sol/10143/run-1790581370358.json)) and a trait-enabled `0xe42f1c5f13b2c8206624fe106d38738a43cb94ec`; earlier V2 and intents contracts (`0x7359…`, `0x54B6…`) and stray redeploys without a fee ceiling (`0xb443…`, `0x21c3…`, `0x6300…`, `0xCC2a…`). The first ones were deployed as `ChogSwap`, `ChogSwapV2` and `ChogSwapIntents`. `web/lib/config.ts` still defaults the Chog collection to that MockChog when `NEXT_PUBLIC_CHOG_ADDRESS` is blank. Deployer: `0x503135438bbc176aea22ec9faaf4470da3272af9`.

## Repo map

| Path                                                       | What                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`docs/01-product-spec.md`](docs/01-product-spec.md)       | What we're building and why: the Club story, the trading engine, the demo script   |
| [`docs/02-architecture.md`](docs/02-architecture.md)       | System diagram, components, key flows, network                                      |
| [`docs/03-contract-design.md`](docs/03-contract-design.md) | State machine, storage, every function's checks and effects, events, errors         |
| [`docs/04-security.md`](docs/04-security.md)               | Trust model, invariants, threats, test plan                                         |
| [`docs/05-frontend.md`](docs/05-frontend.md)               | Screens → contract calls, tx flow, error copy                                       |
| [`docs/06-roadmap.md`](docs/06-roadmap.md)                 | Phase checklist and open questions                                                  |
| [`docs/07-user-guide.md`](docs/07-user-guide.md)           | How to make, take and track deals, fees, Clubs (the in-app Guide's source)          |
| [`docs/08-art-direction.md`](docs/08-art-direction.md)     | Visual language, logo and artwork                                                   |
| [`docs/09-clubs.md`](docs/09-clubs.md)                     | Clubs, Momentum, Rewards and signed posts: the spec, roles, data, API             |
| [`docs/10-privy.md`](docs/10-privy.md)                     | What Privy powers, why embedded wallets are off by default, demo script and setup   |
| [`docs/11-test-plan.md`](docs/11-test-plan.md)           | Pre-mainnet test plan: automated suites, manual testnet cases, go/no-go and canary   |
| [`docs/adr/`](docs/adr/README.md)                          | Architecture decision records ([index](docs/adr/README.md))                         |
| [`contracts/`](contracts/)                                 | Foundry project: `src/DeClubEscrow.sol`, `src/DeClubIntents.sol`, `src/FeeAdmin.sol`, `src/mocks/`, tests, deploy scripts (`DeployEscrow`, `DeployIntents`, `DeployChog`) |
| [`matcher/`](matcher/)                                     | Intent pool (HTTP + sqlite) and local matcher for signed intents ([README](matcher/README.md)) |
| [`e2e/`](e2e/README.md)                                     | End-to-end scenarios on anvil or testnet, read-only deployment checks, web smoke tests |
| [`scripts/test-all.sh`](scripts/test-all.sh)               | Every automated check in one command (the pre-mainnet gate)                          |
| [`web/`](web/)                                             | Next.js app: routes, components, hooks, generated ABIs ([README](web/README.md))    |

## Stack

- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin
- **Frontend:** Next.js 16, TypeScript, wagmi 3, viem, Tailwind 4, Privy (sign-in and linked accounts), Upstash Redis (server store), svix (Privy webhook verification)
- **Matcher:** Node 24, viem, `node:sqlite`
- **Chain:** Monad testnet (chain id 10143); test tokens from `contracts/src/mocks/` (MockChog, a Chog Genesis mirror, mUSD; MockWMON for the fee) for the demo

## Quickstart

```bash
# Toolchain (once)
curl -L https://foundry.paradigm.xyz | bash && foundryup

cd contracts
git submodule update --init --recursive   # forge-std, openzeppelin-contracts
forge build
forge test                                # 431 tests incl. fuzz + invariants
forge coverage --report summary --no-match-coverage "(test|script)"
```

To deploy to Monad testnet, see [`contracts/script/README.md`](contracts/script/README.md).

```bash
# Intent pool and matcher (needs Node 24+; the tests also need anvil and `forge build`)
cd matcher && npm install && npm test
```

```bash
# Everything at once: contracts, matcher, web (incl. build) and the e2e scenarios on anvil
scripts/test-all.sh            # --quick, --coverage --slither --halmos; see docs/11-test-plan.md
```

```bash
# Frontend
cd web && npm install && npm run dev      # http://localhost:3000
```

```bash
# Club Rewards: build the epoch that just ended and, with the operator's testnet key, fund it
cd web && npm run rewards:epoch -- --publish
```

Only the Chog collection, chain and RPC have defaults. Set `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS` (and `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` for signed swaps, `NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS` for claims) in the root `.env`, or there are no deals outside the development mocks. See [`.env.example`](.env.example) and [`web/README.md`](web/README.md).
