# 04 · Security

The contract holds other people's Chogs and MON, so every decision below is aimed at one guarantee:

> **Every escrowed asset has a deterministic path to settlement or refund. Nothing is ever locked forever.**

## Trust model

| Actor | Can | Cannot |
|---|---|---|
| Maker | Create, cancel their own open trade, withdraw credited MON | Change terms after creation; take back escrow after a fill |
| Taker | Fill an open, unexpired trade they're allowed to fill | Fill with the wrong NFTs or the wrong MON amount; fill twice |
| Anyone | Reclaim an expired trade *to its maker* | Redirect a refund; cancel someone else's trade |
| Deployer | Nothing after deploy | Pause, upgrade, sweep or fee-switch (none of these exist) |

## Invariants

Each one becomes a Foundry invariant or property test in Phase 1.

| # | Invariant |
|---|---|
| I1 | For every trade with `status == Open`, `chog.ownerOf(id) == address(swap)` for each of its `offeredIds`. |
| I2 | The contract owns no Chog that isn't in some open trade's `offeredIds`. |
| I3 | `address(swap).balance == Σ offeredMon over Open trades + Σ pendingWithdrawal`. |
| I4 | A trade's status only moves `None → Open → {Filled, Cancelled}`, and never leaves a terminal state. |
| I5 | `tradeCount` only increases, and every id in `1..tradeCount` has `status != None`. |
| I6 | A trade can't be filled when `isExpired`. |
| I7 | Refunds always go to `trade.maker`, whoever calls. |

(I3 treats the balance as exact. It can only drift upward from forced MON via `selfdestruct`; that can't be prevented and doesn't hurt anyone.)

## Threats and mitigations

| Threat | Mitigation | Test |
|---|---|---|
| **Double fill / double refund** | Status is checked and then set to a terminal value *before* any external call. `nonReentrant` on every mutating function. | `test_fill_revertsWhenFilled`, `test_cancel_revertsAfterFill`, reentrancy mock |
| **Reentrancy through MON sends** | CEI + `nonReentrant`. MON is sent last. | Malicious receiver that re-enters `fillTrade`, `cancelTrade` and `withdraw` |
| **Reentrancy through NFT hooks** | Only `transferFrom` is used, so there's no `onERC721Received` callback. | Covered by design; a test asserts no receiver is called |
| **Wrong NFT** | Requested ids are fixed at creation. The fill moves exactly those ids from `msg.sender`, and the Chog contract reverts if the sender doesn't own them. | `test_fill_revertsIfTakerDoesNotOwnRequested` |
| **Insufficient / excess MON** | `msg.value == requestedMon` exactly (`WrongMonAmount`). | Fuzz `msg.value != requestedMon` |
| **Unauthorised cancel** | `msg.sender == maker`. | `test_cancel_revertsForNonMaker` |
| **Unauthorised taker on a direct request** | `taker != 0 → msg.sender == taker`. | `test_fill_revertsForWrongTaker` |
| **Fill after expiry** | `TradeIsExpired`. | Warp to `expiry + 1` |
| **Assets locked by an unresponsive party** | The taker's assets are never escrowed. The maker can cancel at any time, and anyone can reclaim after expiry. | Invariant I1/I2 run under random handler sequences |
| **Maker's MON refund griefed by a reverting receiver** | `_sendMon` credits `pendingWithdrawal` instead of reverting. | Maker contract whose `receive()` reverts, then `withdraw` from an EOA-style path |
| **Maker front-runs a fill by cancelling** | Allowed and harmless: the fill reverts with `TradeNotOpen` and the taker only loses gas. | — |
| **Terms swapped under the taker** | Terms can't change after creation. | — |
| **Stray deposits** | No `receive()` or `fallback()` and no `IERC721Receiver`, so plain MON sends and `safeTransferFrom` into the contract revert. | `test_rejectsDirectMon`, `test_rejectsSafeTransfer` |
| **Unbounded gas per fill** | `MAX_TOKENS_PER_SIDE = 10`. | `test_create_revertsTooManyTokens`, `forge snapshot` |
| **Duplicate ids on one side** | The second `transferFrom` reverts, because the token already moved. | `test_create_revertsOnDuplicateOffered` |
| **Offered and requested overlap** | A requested id that is also offered is held by escrow, so no taker can own it and the fill always reverts. The maker can still cancel. The UI blocks this at creation. | Unit test documents the behaviour |
| **Gas-griefing MON recipient** | `_sendMon` forwards all gas. A maker contract that burns gas in `receive()` can make fills of its *own* trade fail, which costs takers gas but steals nothing. Accepted for v1; revisit with a gas stipend if this happens in practice. | — |

## Accepted limitations (v1)

- **No price oracle and no slippage protection.** Terms are exact and set by the maker.
- **Approvals.** The UI asks for `setApprovalForAll(ChogSwap)`. That's standard for NFT marketplaces, but it means a hypothetical bug in ChogSwap could move any approved Chog. Mitigations: small audited-style surface, no upgradeability, and the UI shows a "Revoke approval" option.
- **Stale requests.** A trade can ask for a Chog that is later sold elsewhere. It stays fillable only by whoever owns that Chog next. The UI shows the current owner.

## Test suite

```text
contracts/test/
├── ChogSwap.create.t.sol      validation errors, escrow pulled, event fields, max side size
├── ChogSwap.fill.t.sol        spec 4.1–4.3, multi-Chog, MON-only sides, every revert, worst-case gas
├── ChogSwap.cancel.t.sol      cancel before/after expiry, non-maker, named taker, after fill, twice
├── ChogSwap.reclaim.t.sol     expiry boundary, caller gets nothing, no-expiry trades, terminal states
├── ChogSwap.withdraw.t.sol    MON-rejecting maker/taker credited on fill/cancel/reclaim; withdraw
├── ChogSwap.reentrancy.t.sol  re-entry from every MON payout into cancel/fill/withdraw/create
├── ChogSwap.guards.t.sol      constructor checks, views, direct MON / safeTransfer rejected
├── ChogSwap.fuzz.t.sol        MON conservation, wrong msg.value, expiry boundary, access control
├── MockChog.t.sol             mint, traits, tokenURI
├── Deploy.t.sol               deploy script: mock vs existing collection, demo mints, CSV parsing
├── utils/                     shared fixture (ChogSwapBase), MonReceiver, ReentrantReceiver
└── invariant/
    ├── Handler.sol            random create/fill/cancel/reclaim/withdraw/warp across 3 EOAs
    │                          and 1 MON-rejecting contract, with ghost accounting
    └── ChogSwap.invariant.t.sol   I1–I7, plus liveness: a valid fill never reverts
```

**Exit criteria, all met:**

- `forge test`: 91 tests pass.
- `forge coverage`: 100% of lines, statements, branches and functions on `ChogSwap.sol` and `MockChog.sol`.
- Invariants hold at 256 runs × depth 64 (16,384 handler calls per run).

## Static analysis

**Slither** (`slither src/ChogSwap.sol --exclude-informational --exclude-optimization`) returned 9 results:

| Detector | Impact | Verdict |
|---|---|---|
| `reentrancy-eth` (credit written after a MON send in `fillTrade`) | High | **False positive.** Every external entry point, including `withdraw`, is `nonReentrant`. The credit is only written when the send *failed*, so nothing was paid out. Slither doesn't model OZ 5's storage-slot guard. `test_makerCannotWithdrawDuringFill` covers this exact path. |
| `reentrancy-benign` (same line) | Low | Same reasoning. |
| `calls-loop` ×5 | Low | Intended. Loops are capped by `MAX_TOKENS_PER_SIDE`, and the collection is fixed and trusted. A failing transfer should revert the whole trade (atomicity). |
| `timestamp` ×2 | Low | Intended. Expiries are hours or days long, so seconds of validator skew don't matter. |

`forge lint` is clean. Intentional patterns are suppressed inline with a reason, so any new finding stands out.

Before any mainnet deploy with real Chogs: an external review, a re-run of Slither (triaged as above), and a public testnet period.
