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

**Phase 1: protocol, code complete.** `ChogSwap` and `MockChog` are implemented, with 91 tests passing (unit, fuzz, invariant), 100% coverage and Slither triaged. The deploy script has been dry-run against Monad testnet. What's left: a funded testnet deploy. Next up is Phase 2 (UI). See the [roadmap](docs/06-roadmap.md).

## Repo map

| Path | What |
|---|---|
| [`docs/01-product-spec.md`](docs/01-product-spec.md) | What we're building and why, MVP scope, demo script |
| [`docs/02-architecture.md`](docs/02-architecture.md) | System diagram, components, key flows, network |
| [`docs/03-contract-design.md`](docs/03-contract-design.md) | State machine, storage, every function's checks and effects, events, errors |
| [`docs/04-security.md`](docs/04-security.md) | Trust model, invariants, threats, test plan |
| [`docs/05-frontend.md`](docs/05-frontend.md) | Screens → contract calls, tx flow, error copy |
| [`docs/06-roadmap.md`](docs/06-roadmap.md) | Phase checklist and open questions |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`contracts/`](contracts/) | Foundry project: `src/ChogSwap.sol`, `src/mocks/MockChog.sol`, tests, deploy script |
| [`web/`](web/) | Next.js app (Phase 2) |

## Stack

- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin
- **Frontend:** Next.js, TypeScript, wagmi, viem, Tailwind
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
