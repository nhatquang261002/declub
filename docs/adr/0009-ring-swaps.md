# ADR 0009: Multi-party ring swaps

**Status:** Accepted · 2026-10-01 · Phase 4. Contract side implemented in `OnDealIntents` (rings of 2 to 4 tested, worst case 3.3M gas); the matcher's cycle search is built in [`matcher/`](../../matcher/README.md). Depends on [ADR 0008](0008-trade-intents.md): it uses the same `Intent`, signing, nonces and `settle`, and ships in the same contract.

## Context

Two-party swaps need a **double coincidence of wants**: you have what I want, and I have what you want. Plenty of useful trades don't have that. Alice holds a Chog and wants Bob's NFT, Bob wants Carol's mUSD, and Carol wants Alice's Chog. No two of them can trade, but all three can, in a ring.

With signed intents ([ADR 0008](0008-trade-intents.md)) a ring costs almost nothing extra. Nobody escrows, so there is nothing to coordinate or unwind. The only change is that `settle` takes a longer list.

## Decision

**A ring is a cycle of intents.** `settle(cycle, signatures)` already pays `cycle[i].give` to `cycle[(i+1) % n].maker`. ADR 0008 fixed the rules for `n = 2`. This ADR sets the rules for `n > 2`. There is no separate ring function, no separate typehash and no separate nonce space, so one code path serves both and the two-party case is just `n = 2`.

### What a ring can express

Each participant's **entire `give` goes to exactly one other participant**: the next in the cycle. Each participant's **`want` must be satisfied entirely by the previous one's `give`**. So:

- Alice gives X, Bob gives Y, Carol gives Z.
- Alice's `want` is covered by Carol's `give`, Bob's by Alice's, Carol's by Bob's.

What it can't express: a participant who wants A from one person and B from another, or who gives half their assets to each of two people. That would be bundle matching, a harder problem. It's out of scope; anyone who needs it posts two intents.

### Contract rules for `n > 2`

On top of ADR 0008's per-intent checks:

- `2 <= n <= MAX_CYCLE`, with **`MAX_CYCLE = 4`**. It's a constant in an immutable contract, so it's a decision rather than a setting. It is set by the worst-case gas test (4 intents × 10 assets, mostly ERC-721), and lowered if that test doesn't fit comfortably in a block on Monad. It can't be raised later without a redeploy.
- **Every maker is distinct** (`DuplicateMaker`). This keeps a single address from appearing twice to wash-trade or to make the cycle check ambiguous. Someone who wants to sit in a ring twice uses a second address.
- **Consume every nonce before any asset moves**, then transfer. A hook on any token in the ring (an ERC-777-style ERC-20) can't re-enter `settle` (`nonReentrant`) and can't replay an intent in the same call.
- **The order of transfers inside a ring doesn't matter** for correctness: each transfer is wallet to wallet, and the contract holds nothing between them, so there is no intermediate escrowed state to exploit. A token that fails or misbehaves reverts the whole ring.

### Failure is more fragile than in a pair

In a two-party swap, either side breaking their intent kills the settlement. In a ring of four, any of four can. The failure is still safe, because it reverts everything and nobody loses assets, but the matcher should expect it:

- It **simulates the ring with `eth_call` immediately before sending**, as for pairs.
- When a simulation fails, it identifies the offending intent (by simulating each `transferFrom` leg, or by checking balance, ownership and approval per participant), drops it from the pool, and re-runs matching without it.
- It **keeps a per-maker failure count** and deprioritises or ignores makers whose intents repeatedly fail on-chain checks. That costs them nothing but liquidity, and protects the matcher's gas.

### Matching rings

The matcher builds a directed graph with the intents as nodes. There is an edge `i → j` when `i.give` satisfies `j.want` (every asset in `j.want` is covered by something in `i.give`, and the other way is not required, since surplus goes to `j`). A ring is a cycle of length 2 to `MAX_CYCLE` in that graph.

- **Search.** Bounded depth-first search from each node, depth capped at `MAX_CYCLE`, pruned by asset-key indexes so it only follows edges that exist. Pool sizes at this scale make this cheap; if they grow, restrict the search to intents touching the same asset keys.
- **Choosing between cycles.** Each intent can be in only one settlement (its nonce is consumed). Prefer, in order: the most intents settled in a batch, then the oldest intent first. Greedy is fine to start; if it isn't, this is a maximum-cycle-packing problem and gets its own ADR then.
- **Always simulate before sending.** A cycle in the graph isn't a valid settlement until the chain says so: balances, approvals, nonces and deadlines can all have changed since the pool last checked.

### What participants see

Nobody "creates a ring". They post intents ([ADR 0008](0008-trade-intents.md)). The app shows an intent as matched when it settles, with the full cycle: who gave what to whom, and what the participant received. Before settlement it shows the intent as open, as for any other.

Signing an intent consents to **any** counterparties that satisfy it, so in a ring the participant may never have heard of the other parties. The UI must say that, and an optional counterparty restriction (an open question in ADR 0008) would apply to rings too.

## Trust model

Same as ADR 0008. In addition:

- A ring can't give a participant less than `want` or take more than `give`: those are checked per intent, whatever the cycle is.
- A matcher that orders or chooses cycles unfairly can steer surplus (receivers keep any amount above their `want`). Participants who want a fixed price set `want` equal to what they expect to get. The contract can't stop surplus capture because it doesn't pick the cycle.
- Because nothing is escrowed, **a participant can't be stuck in an unfinished ring**. There is no such thing as a half-complete ring on-chain.

## Known limitations

- **Cycle shapes are limited** (one giver and one receiver per participant) for the reasons above.
- **The more parties, the more likely a ring fails** at simulation or settlement. In practice rings will be rare and mostly three-way.
- **No partial rings.** All-or-nothing, like everything here.
- **The matcher is trusted for liveness and fairness, not safety.** Same as ADR 0008.

## Consequences

- No extra deployment: the intents contract already handles rings through `settle`. The extra work is the matcher's cycle search, the worst-case gas test for `MAX_CYCLE`, ring-specific fuzz and invariants, and the "matched in a ring" UI.
- New tests beyond ADR 0008's: rings of every length from 2 to `MAX_CYCLE`, a ring with one bad signature, one expired intent, one used nonce, a duplicate maker, a ring where one participant moved their asset, a hook token trying to re-enter, and a fuzz over random valid cycles that checks invariants N1 to N5 still hold.
- Gas worst case is measured and recorded in [03 · Contract Design](../03-contract-design.md#gas-worst-case-4-makers--10-nfts-each-way), like V2's.
- Needs external review with ADR 0008.

## Decisions on the open questions (2026-10-01)

- **`MAX_CYCLE = 4`**, chosen over 6 for gas headroom and simpler matching. The worst-case gas test (4 makers × 10 NFTs each way) came in at **3.3M gas**, so 4 stands.
- Participant confirmation before sending a ring: no. It would break "free and instant".
- Bundle matching and reputation stay out of scope.
