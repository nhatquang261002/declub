# On Deal

> **Trustless OTC trading and programmable escrow on Monad.**
>
> *Trade what you have for what you actually want, without trusting the other side.*

On Deal lets two people swap any ERC-721, ERC-20 and MON, in any mix, through an on-chain escrow (`OnDealV2`) that settles atomically:

```text
Alice: Chog #421           ⇄           Bob: Chog #812 + 50 mUSD

createTrade     → Alice's #421 locked in OnDealV2
fillTrade       → one tx: #812 + 50 mUSD → Alice, #421 → Bob
cancel / expiry → #421 back to Alice. Nothing is ever stuck.
```

A locked deal can ask for exact assets, for any NFT with given traits ("any Chog with a Crown"), or for offers. A **signed swap** locks nothing: each side signs what it gives and wants, and a matcher settles pairs and rings of up to four through `OnDealIntents`. Every side of a completed deal pays a small flat protocol fee, which a fee admin can change within a ceiling fixed at deploy ([ADR 0018](docs/adr/0018-adjustable-protocol-fee.md)). The original `OnDeal` (v1, one Chog collection plus MON) is still in the repo as the legacy contract; the app no longer uses it.

## Status

- **Protocol: built.** `OnDealV2`, `OnDealIntents`, the shared `FeeAdmin`, legacy `OnDeal` and the mocks, with 440 Foundry tests passing in 39 suites (unit, fuzz, invariant) and Slither triaged ([04 · Security](docs/04-security.md)). The matcher has 79 tests and the web app 260 unit tests.
- **App: built.** The Next.js app in [`web/`](web/) has the deal list (searched and filtered on the server), Create (lock or sign), the deal and signed-swap pages, History, Clubs, Account, the Guide, notifications and Privy sign-in. Left: a click-through on testnet with real wallets.
- **Testnet: needs a redeploy.** The deployed contracts predate the protocol fee and the current intents domain (see below).

See the [roadmap](docs/06-roadmap.md).

## Built with Privy

Privy is On Deal's identity layer for trading with strangers, not just its sign-in:

- **Verified trader profiles:** a maker's X or Discord handle, read from Privy's linked accounts on the server, shows beside their wallet on every deal.
- **Make a deal for @handle:** type the counterparty's X or Discord handle, and Privy's user lookup finds the wallet to lock the deal to, so nobody pastes an address from a DM.
- **Webhooks** keep those profiles and Club memberships accurate when an account is unlinked, transferred or deleted.
- **One person, many wallets:** link a vault and a hot wallet. Club Holder badges count assets across all of them, and Club roles and bans follow the Privy user, not one wallet.
- **Per-user server state** is authorized by verified Privy access tokens.

Embedded wallets are off by default, because traders bring the wallet that already holds their collection; `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=true` turns them on for social sign-ins. Without `NEXT_PUBLIC_PRIVY_APP_ID` the app falls back to a plain injected-wallet connect. Details, the demo script and setup: [docs/10-privy.md](docs/10-privy.md).

## Deployments: Monad testnet (chain 10143)

What the app is configured with today (the root `.env`):

| Contract | Address | Block | Record |
| -------- | ------- | ----- | ------ |
| OnDealV2 | [`0x73591F76d7deE66F683A979cEffb4356982EE1bB`](https://testnet.monadvision.com/address/0x73591F76d7deE66F683A979cEffb4356982EE1bB) | 67163690 | [`DeployV2 run-1790829432382.json`](contracts/broadcast/DeployV2.s.sol/10143/run-1790829432382.json) |
| OnDealIntents | [`0x54B6d5d25811fe42607a5a9CeBc8F7Bdd58A0Fd2`](https://testnet.monadvision.com/address/0x54B6d5d25811fe42607a5a9CeBc8F7Bdd58A0Fd2) | 67194397 | [`DeployIntents run-latest.json`](contracts/broadcast/DeployIntents.s.sol/10143/run-latest.json) |
| MockERC20 (mUSD) | [`0xd300f095f456D59AAc122B0100833fE195136F6c`](https://testnet.monadvision.com/address/0xd300f095f456D59AAc122B0100833fE195136F6c) | 66874652 | [`DeployV2 run-1790742069295.json`](contracts/broadcast/DeployV2.s.sol/10143/run-1790742069295.json) |
| Chog collection (ChogGenesisMirror) | [`0x32a325b0640594377d0708ca9081c93da95e1908`](https://testnet.monadvision.com/address/0x32a325b0640594377d0708ca9081c93da95e1908) | 66576933 | [`Deploy run-latest.json`](contracts/broadcast/Deploy.s.sol/10143/run-latest.json) |

> **Neither deal contract matches the current source** (nor does any other deployed V2 or intents contract). They predate the protocol fee and `FeeAdmin` (`fee()` and `feeAdmin()` revert on them), and the intents contract signs with the EIP-712 domain `("ChogSwapIntents", "1")`, while the code, the matcher and the app use `("OnDealIntents", "3")` with `feeToken` / `maxFee`. Redeploy `DeployV2.s.sol` and `DeployIntents.s.sol` from the current source ([how](contracts/script/README.md)) and update the addresses before the fee and signed swaps work on testnet.

Other testnet deployments, not used by the app:

- A later `OnDealV2` at `0x67a4a4ddfab155689ce2ee40c9c2157cea8e68fc` (block 67193827, [`DeployV2 run-latest.json`](contracts/broadcast/DeployV2.s.sol/10143/run-latest.json)), also without the fee. The first V2 at `0x8a05…CC75` (block 66874644, with mUSD) is superseded.
- Legacy `OnDeal` (v1): the original `0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298` with `MockChog` `0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4` (blocks 66352698 / 66352681, [`Deploy run-1790581370358.json`](contracts/broadcast/Deploy.s.sol/10143/run-1790581370358.json)), and a trait-enabled `0xe42f1c5f13b2c8206624fe106d38738a43cb94ec` beside the Chog mirror ([`Deploy run-latest.json`](contracts/broadcast/Deploy.s.sol/10143/run-latest.json)). `web/lib/config.ts` still defaults the Chog collection to that MockChog when `NEXT_PUBLIC_CHOG_ADDRESS` is blank.

Contracts were deployed under their old names (`ChogSwap`, `ChogSwapV2`, `ChogSwapIntents`) before the rename to On Deal. The V2s at `0x7359…` and `0x67a4…`, the intents contract, mUSD, the original v1 and MockChog are source-verified on Sourcify; the Chog mirror and the second v1 are not. Deployer: `0x503135438bbc176aea22ec9faaf4470da3272af9`. The matcher in [`matcher/`](matcher/README.md) settles through the intents contract.

## Repo map

| Path                                                       | What                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`docs/01-product-spec.md`](docs/01-product-spec.md)       | What we're building and why, MVP scope, demo script                                 |
| [`docs/02-architecture.md`](docs/02-architecture.md)       | System diagram, components, key flows, network                                      |
| [`docs/03-contract-design.md`](docs/03-contract-design.md) | State machine, storage, every function's checks and effects, events, errors         |
| [`docs/04-security.md`](docs/04-security.md)               | Trust model, invariants, threats, test plan                                         |
| [`docs/05-frontend.md`](docs/05-frontend.md)               | Screens → contract calls, tx flow, error copy                                       |
| [`docs/06-roadmap.md`](docs/06-roadmap.md)                 | Phase checklist and open questions                                                  |
| [`docs/07-user-guide.md`](docs/07-user-guide.md)           | How to make, take and track deals, fees, Clubs (the in-app Guide's source)          |
| [`docs/08-art-direction.md`](docs/08-art-direction.md)     | Visual language, logo and artwork                                                   |
| [`docs/09-clubs.md`](docs/09-clubs.md)                     | Clubs and Momentum: a community per verified asset (spec, roles, data, API)         |
| [`docs/10-privy.md`](docs/10-privy.md)                     | What Privy powers, why embedded wallets are off by default, demo script and setup   |
| [`docs/adr/`](docs/adr/README.md)                          | Architecture decision records ([index](docs/adr/README.md))                         |
| [`contracts/`](contracts/)                                 | Foundry project: `src/OnDealV2.sol`, `src/OnDealIntents.sol`, `src/FeeAdmin.sol`, `src/OnDeal.sol` (legacy v1), `src/mocks/`, tests, three deploy scripts (`Deploy`, `DeployV2`, `DeployIntents`) |
| [`matcher/`](matcher/)                                     | Intent pool (HTTP + sqlite) and local matcher for signed intents ([README](matcher/README.md)) |
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
forge test                                # 440 tests incl. fuzz + invariants
forge coverage --report summary --no-match-coverage "(test|script)"
```

To deploy to Monad testnet, see [`contracts/script/README.md`](contracts/script/README.md).

```bash
# Intent pool and matcher (needs Node 24+; the tests also need anvil and `forge build`)
cd matcher && npm install && npm test
```

```bash
# Frontend
cd web && npm install && npm run dev      # http://localhost:3000
```

Only the Chog collection, chain and RPC have defaults. Set `NEXT_PUBLIC_ON_DEAL_V2_ADDRESS` (and `NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS` for signed swaps) in the root `.env`, or there are no deals outside the development mocks. See [`.env.example`](.env.example) and [`web/README.md`](web/README.md).
