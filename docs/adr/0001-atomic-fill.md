# ADR 0001: Atomic fill instead of a two-sided deposit phase

**Status:** Accepted · 2026-09-28

## Context

The original spec describes this flow:

```text
OPEN → ACCEPT → DEPOSITING → (both deposited) → READY → EXECUTE → EXECUTED
```

Both parties deposit into escrow separately, and someone then calls `executeTrade`.

That creates the problems escrow is meant to solve:

- Once Bob has deposited, his assets are locked until Alice acts, or until expiry and a refund.
- It needs extra states (`ACCEPTED`, `DEPOSITING`, `READY`), extra refund paths for *both* sides, and rules for who may execute.
- It takes at least three transactions for a simple swap.
- The attack surface is larger: partial deposits, deposits to the wrong trade, the maker walking away while holding the taker's funds hostage.

## Decision

- **The maker escrows on creation.** `createTrade` pulls the maker's Chogs and MON in the same transaction.
- **The taker fills atomically.** `fillTrade` pulls the taker's requested Chogs and MON and settles every transfer in one transaction. The taker's assets are never held by the contract.
- States: `Open → Filled | Cancelled`. Expiry is derived from the timestamp.

## Consequences

**Good**

- A trade can't get stuck halfway. The only escrowed assets are the maker's, and the maker can always cancel them (or anyone can reclaim them after expiry).
- Two transactions per swap (plus a one-time approval each).
- A smaller state machine means fewer tests and fewer bugs.
- The "Alice ✓ / Bob ✗ → ✓" escrow story still works in the UI.

**Trade-offs**

- The taker has to hold the requested assets at the moment of filling. Nobody can pre-commit and wait.
- Multi-party ring swaps (Phase 4) do need a deposit phase. They'll get a separate trade type with per-leg escrow rather than complicating the two-party path.
