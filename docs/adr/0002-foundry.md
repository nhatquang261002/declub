# ADR 0002: Foundry for contracts

**Status:** Accepted · 2026-09-28

## Context

Contract tooling options were Foundry or Hardhat. Neither was installed; Node 26 was.

## Decision

Use **Foundry** (forge, cast, anvil) in `contracts/`.

## Reasons

- Tests in Solidity, with built-in fuzzing and invariant testing, which is exactly what escrow security needs ([04 · Security](../04-security.md)).
- Fast compile and test loop, `forge coverage`, `forge snapshot`.
- Monad's developer docs use Foundry.
- `@wagmi/cli` has a Foundry plugin, so the frontend still gets typed ABIs.

## Consequences

- Foundry has to be installed (`foundryup`) before Phase 1.
- Dependencies go in `contracts/lib/` through `forge install` (git submodules), not npm.
- The JS/TS tooling lives only in `web/`.
