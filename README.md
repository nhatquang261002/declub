# Chog Swap

> **Trustless OTC trading and programmable escrow for Chogs on Monad.**
>
> *Trade what you have for what you actually want, without trusting the other side.*

Chog Swap lets two people swap Chogs, optionally with MON on one side, through an on-chain escrow that settles atomically:

```text
Alice: Chog #421           ⇄           Bob: Chog #812 + 2 MON

createTrade  → Alice's #421 locked in escrow
fillTrade    → one tx: #812 + 2 MON → Alice, #421 → Bob
cancel / expiry → #421 back to Alice. Nothing is ever stuck.
```

## Status

- **Phase 1: protocol, done.** `ChogSwap` and `MockChog` are live and verified on Monad testnet, with 91 tests passing (unit, fuzz, invariant), 100% coverage and Slither triaged.
- **Phase 2: UI, in progress.** The Next.js app in [`web/`](web/) connects a wallet, lists trades and shows your Chogs (with a MockChog mint for demo wallets). Create, Trade Detail and History are next.

See the [roadmap](docs/06-roadmap.md).

## Deployments: Monad testnet (chain 10143)

| Contract | Address                                                                                                                            | Block    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ChogSwap | [`0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298`](https://testnet.monadvision.com/address/0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298) | 66352698 |
| MockChog | [`0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4`](https://testnet.monadvision.com/address/0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4) | 66352681 |
| ChogSwapV2 | [`0x73591F76d7deE66F683A979cEffb4356982EE1bB`](https://testnet.monadvision.com/address/0x73591F76d7deE66F683A979cEffb4356982EE1bB) | 67163690 |
| ChogSwapIntents | [`0x54B6d5d25811fe42607a5a9CeBc8F7Bdd58A0Fd2`](https://testnet.monadvision.com/address/0x54B6d5d25811fe42607a5a9CeBc8F7Bdd58A0Fd2) | 67194397 |
| MockERC20 (mUSD) | [`0xd300f095f456D59AAc122B0100833fE195136F6c`](https://testnet.monadvision.com/address/0xd300f095f456D59AAc122B0100833fE195136F6c) | 66874652 |

All five are source-verified on Sourcify. ChogSwapV2 is the redeploy with trait requests and open offers; the earlier V2 at `0x8a05…CC75` (block 66874644) is superseded, and mUSD is shared. Deployer: `0x503135438bbc176aea22ec9faaf4470da3272af9`. Transaction records: [`Deploy.s.sol`](contracts/broadcast/Deploy.s.sol/10143/run-latest.json) (v1) [`DeployV2.s.sol`](contracts/broadcast/DeployV2.s.sol/10143/run-latest.json) (V2) and [`DeployIntents.s.sol`](contracts/broadcast/DeployIntents.s.sol/10143/run-latest.json) (intents; the matcher in [`matcher/`](matcher/README.md) settles through it).

## Repo map

| Path                                                       | What                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`docs/01-product-spec.md`](docs/01-product-spec.md)       | What we're building and why, MVP scope, demo script                                 |
| [`docs/02-architecture.md`](docs/02-architecture.md)       | System diagram, components, key flows, network                                      |
| [`docs/03-contract-design.md`](docs/03-contract-design.md) | State machine, storage, every function's checks and effects, events, errors         |
| [`docs/04-security.md`](docs/04-security.md)               | Trust model, invariants, threats, test plan                                         |
| [`docs/05-frontend.md`](docs/05-frontend.md)               | Screens → contract calls, tx flow, error copy                                       |
| [`docs/06-roadmap.md`](docs/06-roadmap.md)                 | Phase checklist and open questions                                                  |
| [`docs/09-clubs.md`](docs/09-clubs.md)                     | Clubs and Momentum: a community per verified asset (spec, roles, data, API)         |
| [`docs/adr/`](docs/adr/)                                   | Architecture decision records                                                       |
| [`contracts/`](contracts/)                                 | Foundry project: `src/ChogSwap.sol`, `src/mocks/MockChog.sol`, tests, deploy script |
| [`matcher/`](matcher/)                                     | Intent pool (HTTP + sqlite) and local matcher for signed intents ([README](matcher/README.md)) |
| [`web/`](web/)                                             | Next.js app: routes, components, hooks, generated ABIs ([README](web/README.md))    |

## Stack

- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin
- **Frontend:** Next.js 16, TypeScript, wagmi 3, viem, Tailwind 4
- **Chain:** Monad testnet (chain id 10143), MockChog for the demo

## Quickstart

```bash
# Toolchain (once)
curl -L https://foundry.paradigm.xyz | bash && foundryup

cd contracts
git submodule update --init --recursive   # forge-std, openzeppelin-contracts
forge build
forge test                                # 91 tests incl. fuzz + invariants
forge coverage --report summary --no-match-coverage "(test|script)"
```

To deploy to Monad testnet, see [`contracts/script/README.md`](contracts/script/README.md).

```bash
# Intent pool and matcher (needs Node 24+; the tests also need anvil and `forge build`)
cd matcher && npm install && npm test
```

```bash
# Frontend (defaults to the testnet deployment above)
cd web && npm install && npm run dev      # http://localhost:3000
```
