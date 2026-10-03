# 04 · Security

`OnDealV2` holds other people's NFTs, ERC-20s and MON in escrow, and `OnDealIntents` moves assets straight between wallets under standing approvals. The legacy `OnDeal` (v1), which escrows Chogs and MON, is still deployed but no longer used by the app. Every decision below is aimed at one guarantee:

> **Every escrowed asset has a deterministic path to settlement or refund. Nothing is ever locked forever.**

The trust model (fee rows aside), invariants, threats and tests up to [Static analysis](#static-analysis) describe v1. `OnDealV2` keeps its trust model, invariants and threats and adds its own ([below](#ondealv2-phase-4)); [OnDealIntents](#ondealintents) has its own.

## Trust model

| Actor | Can | Cannot |
|---|---|---|
| Maker | Create, cancel their own open trade, withdraw credited MON | Change terms after creation; take back escrow after a fill |
| Taker | Fill an open, unexpired trade they're allowed to fill | Fill with the wrong NFTs or the wrong MON amount; fill twice |
| Anyone | Reclaim an expired trade *to its maker* | Redirect a refund; cancel someone else's trade |
| Deployer | Nothing after deploy | Pause, upgrade or sweep (none of these exist), or change the fee recipient, the fee token or the fee ceiling (immutable) |
| Fee admin (`OnDealV2`, `OnDealIntents`) | Lower the fee at once, or queue a raise that takes effect only when it calls `applyFee` 7 days or more later (a newer `setFee` replaces the queued one), never above `MAX_FEE`; hand the role on in two steps, or renounce it for good ([ADR 0018](adr/0018-adjustable-protocol-fee.md)) | Change the fee of an escrow deal already listed, charge an intent more than its signed `maxFee`, raise the fee without the delay, or touch escrow, credits, nonces, the recipient or the token |
| Fee recipient | Receives the protocol fee when a deal completes | Touch escrow, take a fee for a deal that didn't complete, or change the fee |

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
| **Unbounded gas per fill** | `MAX_TOKENS_PER_SIDE = 10`. | `test_create_revertsTooManyOffered`, `test_create_revertsTooManyRequested`, `forge snapshot` |
| **Duplicate ids on one side** | The second `transferFrom` reverts, because the token already moved. | `test_create_revertsOnDuplicateOffered` |
| **Offered and requested overlap** | A requested id that is also offered is held by escrow, so no taker can own it and the fill always reverts. The maker can still cancel. (`OnDealV2` rejects the overlap at creation with `SameAssetBothSides`.) | Unit test documents the behaviour |
| **Gas-griefing MON recipient** | `_sendMon` forwards all gas. A maker contract that burns gas in `receive()` can make fills of its *own* trade fail, which costs takers gas but steals nothing. Accepted for v1; revisit with a gas stipend if this happens in practice. | — |

## Accepted limitations (v1)

- **No price oracle and no slippage protection.** Terms are exact and set by the maker.
- **Approvals.** v1 needs `setApprovalForAll(OnDeal)` on the Chog contract. That's standard for NFT marketplaces, but it means a hypothetical bug in OnDeal could move any approved Chog. Mitigations: small audited-style surface, no upgradeability. The app no longer asks for this approval and has no revoke button, so a wallet that granted it earlier should revoke it from the wallet or an explorer (`setApprovalForAll(OnDeal, false)`).
- **Stale requests.** A trade can ask for a Chog that is later sold elsewhere. It stays fillable only by whoever owns that Chog next.
- **Trait trades can be taken for free.** The plain `fillTrade(tradeId)` doesn't check `requestedRoot`. A trait trade stores no `requestedIds`, so the plain fill moves no Chog from the taker: they pay only `requestedMon` and take the escrow. No test covers this path. Don't create trait trades on v1 ([03](03-contract-design.md#trait-overloads)); `OnDealV2` refuses the same call with `TraitFillRequired`.

## Test suite

```text
contracts/test/
├── OnDeal.create.t.sol      validation errors, escrow pulled, event fields, max side size
├── OnDeal.fill.t.sol        spec 4.1–4.3, multi-Chog, MON-only sides, every revert, worst-case gas
├── OnDeal.cancel.t.sol      cancel before/after expiry, non-maker, named taker, after fill, twice
├── OnDeal.reclaim.t.sol     expiry boundary, caller gets nothing, no-expiry trades, terminal states
├── OnDeal.withdraw.t.sol    MON-rejecting maker/taker credited on fill/cancel/reclaim; withdraw
├── OnDeal.reentrancy.t.sol  re-entry from every MON payout into cancel/fill/withdraw/create
├── OnDeal.guards.t.sol      constructor checks, views, direct MON / safeTransfer rejected
├── OnDeal.fuzz.t.sol        MON conservation, wrong msg.value, expiry boundary, access control
├── OnDeal.traits.t.sol      trait overloads: proof fill, wrong-collection leaf, duplicate ids, exact fill unchanged
├── MockChog.t.sol             mint, traits, tokenURI
├── ChogGenesisMirror.t.sol    name, symbol, IPFS tokenURI, full 1,969 catalog
├── MockWMON.t.sol             wrap, unwrap, plain transfer wraps, failed unwrap reverts
├── Deploy.t.sol               deploy script: MockChog vs existing collection, demo mints, CSV parsing (the mirror path has no test)
├── FeeAdmin.t.sol             the fee admin (ADR 0018), 22 tests run against OnDealV2 and OnDealIntents (44)
├── utils/                     shared fixture (OnDealBase), actors (MonReceiver, ReentrantReceiver), WeirdTokens
└── invariant/
    ├── Handler.sol            random create/fill/cancel/reclaim/withdraw/warp across 3 EOAs
    │                          and 1 MON-rejecting contract, with ghost accounting
    └── OnDeal.invariant.t.sol   I1–I7, plus liveness: a valid fill never reverts
```

**Exit criteria, all met:**

- `forge test`: all 440 tests pass, in 39 suites, across `OnDeal`, `OnDealV2`, `OnDealIntents`, `FeeAdmin`, the mocks and the deploy scripts. The top level of `contracts/test/` (the files above) has 145 of them plus the invariant suite.
- `forge coverage`: 100% of lines, statements, branches and functions on `MockChog.sol` and on `OnDeal.sol`'s exact-id paths. The trait overloads only have the four tests in `OnDeal.traits.t.sol`; their other reverts, and the plain fill of a trait trade, are untested.
- Invariants hold at 256 runs × depth 64 (16,384 handler calls per run).

## Static analysis

**Slither** (`slither src/OnDeal.sol --exclude-informational --exclude-optimization`) returned 9 results:

| Detector | Impact | Verdict |
|---|---|---|
| `reentrancy-eth` (credit written after a MON send in `fillTrade`) | High | **False positive.** Every external entry point, including `withdraw`, is `nonReentrant`. The credit is only written when the send *failed*, so nothing was paid out. Slither doesn't model OZ 5's storage-slot guard. `test_makerCannotWithdrawDuringFill` covers this exact path. |
| `reentrancy-benign` (same line) | Low | Same reasoning. |
| `calls-loop` ×5 | Low | Intended. Loops are capped by `MAX_TOKENS_PER_SIDE`, and the collection is fixed and trusted. A failing transfer should revert the whole trade (atomicity). |
| `timestamp` ×2 | Low | Intended. Expiries are hours or days long, so seconds of validator skew don't matter. |

`forge lint` is clean. Intentional patterns are suppressed inline with a reason, so any new finding stands out.

Before any mainnet deploy with real Chogs: an external review, a re-run of Slither (triaged as above), and a public testnet period.

## `OnDealV2` (Phase 4)

Design: [ADR 0005](adr/0005-generic-asset-model.md). The guarantee is the same, and the trust model is v1's with `withdraw()` replaced by `claim()`, plus open offers ([ADR 0007](adr/0007-open-offers.md)):

| Actor | Can | Cannot |
|---|---|---|
| Proposer | Escrow a proposal on an open offer it may answer (anyone, or only the named `taker`); withdraw an `Active` proposal at any time, whatever the trade's state | Change a proposal after `propose`; propose on its own offer or after expiry; have it settled without the maker's `acceptProposal` |
| Maker (open offer) | Reject an `Active` proposal while the trade is open (also after expiry); accept one until expiry | Take a proposal's assets without settling the offer; touch the other proposals, which stay `Active` after an accept until their proposers withdraw them |

The differences that matter:

### Invariants

Recomputed from the trades themselves in `test/v2/invariant/`, over native, two ERC-20s (one with a blocklist that the handler toggles) and NFTs, with a MON-rejecting actor.

| # | Invariant |
|---|---|
| V1 | `address(swap).balance == Σ native offered by Open trades + Σ native credits`. |
| V2 | For every ERC-20 the escrow holds: `balanceOf(swap) == Σ offered amount over Open trades + Σ credits`. |
| V3 | The escrow owns an NFT if and only if an Open trade offers it. |
| V4–V5 | As I4 / I5: statuses only move `None → Open → {Filled, Cancelled}`, ids are contiguous. |
| V6 | No fill after expiry. |
| V7 | A fill or refund leaves each party holding (balance + credit) exactly what the terms say, and a reclaim caller who isn't the maker gets nothing. |
| V8 | `fillTrade` never settles an open offer, and every valid proposal call succeeds. |
| Liveness | A fill the taker can pay, and any cancel by the maker, never reverts, even with a blocklisted recipient. An expired open trade can always be reclaimed. |

**Protocol fee** ([ADR 0015](adr/0015-protocol-fee.md), [ADR 0018](adr/0018-adjustable-protocol-fee.md)). The invariant suite starts with a 3 MON fee (ceiling 12), a fee recipient that sometimes rejects MON, and a fee admin that changes the fee during the run, so trades carry different fees. V1 becomes `balance == Σ native offered by Open trades + each Open trade's own fee, once for the trade and once per Active proposal + Σ native credits` (the recipient's credit included), and **V9** says the recipient holds exactly `2 × the trade's fee` per completed deal (a fill or an accepted proposal), as MON or as a credit, and nothing for a deal that was cancelled, reclaimed, rejected or withdrawn. Refunds and releases are checked per call in the handler, at the trade's own fee. The fee suite (`OnDealV2.fee.t.sol`, 37 tests) covers the exact `msg.value` on every payable entry, release on fill and accept, refund on cancel, reclaim, reject and withdraw (also after the offer ended), a deal listed before a raise or a cut that fills, proposes and refunds at its own fee, a recipient that rejects MON or tries to re-enter, the zero fee and the constructor guards.

**Fee admin** (`FeeAdmin.t.sol`, 22 tests, run against both contracts): a cut applies at once and drops a queued raise, a raise only applies through `applyFee` after exactly 7 days and a newer one restarts the clock, never above the ceiling, the two-step handover and its cancellation, renounce dropping any queued raise or handover, a zero admin at deploy, and everything a stranger or the recipient is refused. A fuzz test checks that the fee never exceeds the ceiling and never rises without the full delay.

Mutation checks: removing the credit on a failed payout, redirecting reclaimed assets to the caller, and allowing fills after expiry each make the invariant suite fail.

### Threats (additions to the table above)

| Threat | Mitigation | Test |
|---|---|---|
| **Fee-on-transfer / rebasing / lying ERC-20** breaks escrow accounting | Balance-delta check on every ERC-20 deposit (`UnsupportedToken`) | `test_feeOnTransferTokenIsRejectedAsOffered`, `test_tokenThatLiesAboutTransferIsRejected` |
| **Lying ERC-721** | `ownerOf(id) == escrow` after the deposit (`NftNotReceived`) | `test_nftThatLiesAboutTransferIsRejected` |
| **Blocklisted recipient (USDC-style) locks a refund or fill** | Payouts out of escrow never revert: they become credits for `claim` | `OnDealV2.claim.t.sol` (native, ERC-20, ERC-721; fill, cancel, reclaim) |
| **Token hook re-enters** (ERC-777 style) | `nonReentrant` on every mutating function, including `claim` | `test_tokenHookCannotReenterDuring{Deposit,Fill,Cancel}`, `test_nativeReceiver*` |
| **USDT-style token with no return value** | `SafeERC20` | `test_noReturnTokenWorksOnBothSides` |
| **Unfillable trade** (same asset both sides, duplicates) | Rejected at creation | `test_revertsSameAssetOnBothSides`, `test_revertsDuplicateAssetOnOneSide` |
| **Partial fill** | One asset failing reverts the whole fill | `test_fillIsAtomic` |
| **Unbounded gas per trade** | `MAX_ASSETS_PER_SIDE = 10`; worst case measured at 2.2M create / 0.9M fill | `test_worstCaseGas` |

### Accepted limitations

- **Any token can be listed.** A scam token only hurts whoever fills a trade that names it. The UI has to show the on-chain symbol, decimals and address.
- **A fee-charging token can still be *requested*.** The maker receives less than the listed amount. It's their own choice of token.
- **A permanently blocked recipient** (the token itself blacklists them) keeps the credit in the escrow forever. The escrow can't do more than offer the claim.
- **Gas-burning token or receiver.** As with v1's MON receiver, one that burns all forwarded gas can make fills of *its own* trades fail. Takers lose gas, nobody loses assets.
- **Approvals.** The app approves each ERC-20 to `OnDealV2` for the exact amount of the deal, not unlimited, and each NFT collection with `setApprovalForAll` (the only way to cover several ids in one transaction; `web/hooks/useAssetApprovals.ts`). For signed swaps it approves `OnDealIntents` for the exact ERC-20 amount (plus the fee), and each NFT on its own with `approve(id)` unless the maker chooses to approve the whole collection (`web/hooks/useIntentReadiness.ts`). The app has no revoke button.
- **A compromised fee admin** can raise the fee to `MAX_FEE` after 7 days' public notice (`FeeChangeQueued`, then `applyFee`), or cut it to zero at once. The contract accepts any ceiling up to `MAX_FEE_LIMIT` (500 MON); 4× the launch fee is only the deploy scripts' default for `PROTOCOL_FEE_MAX_WEI`, so check `MAX_FEE()` on the deployed contract. It can't touch a deal already listed, charge an intent more than its `maxFee`, or move anyone's assets. Keep the admin Safe's signers apart from the recipient's, and watch for `FeeChangeQueued` ([ADR 0018](adr/0018-adjustable-protocol-fee.md)).
- No external review yet.

### Test suite

```text
contracts/test/v2/
├── OnDealV2Base.sol            fixture: 3 wallets with Chogs, two ERC-20s and MON; asset builders
├── OnDealV2.create.t.sol       every validation error, escrow of each asset type, event, max size
├── OnDealV2.fill.t.sol         every type pairing, mixed bundles, atomicity, boundaries, worst-case gas
├── OnDealV2.cancel.t.sol       cancel and reclaim: refunds, access control, states
├── OnDealV2.claim.t.sol        rejected payouts become credits: native, ERC-20, ERC-721
├── OnDealV2.tokens.t.sol       fee / lying / no-return tokens, re-entry, stray deposits
├── OnDealV2.fuzz.t.sol         conservation, exact refunds, wrong value, expiry boundary, access
├── OnDealV2.fee.t.sol          the protocol fee (ADR 0015), fixed per deal across changes (ADR 0018)
├── OnDealV2.offers.t.sol       open offers: notes, propose / withdraw / reject / accept rules, paging, re-entry
├── OnDealV2.traits.t.sol       trait requests: field and spec rules, proofs (one built by the web app), fills, refunds
├── invariant/                    handler + invariants V1–V9, proposal statuses and liveness
├── DeployV2.t.sol, MockERC20.t.sol
contracts/test/utils/WeirdTokens.sol   fee, lying, no-return, blocklist and hook tokens
```

`test/v2/` holds 193 tests plus the invariant suite (unit, fuzz at 1000 runs, invariants at 256 runs × depth 64). Coverage on `OnDealV2.sol` is 100% of lines, statements, branches and functions.

## OnDealIntents

[ADR 0008](adr/0008-trade-intents.md) and [0009](adr/0009-ring-swaps.md). Standing approvals make this contract more sensitive than the escrow ones, so it has no admin beyond the fee amount, no arbitrary calls and no way to move an asset without a valid unexpired signature from its owner.

```text
contracts/test/intents/
├── OnDealIntentsBase.sol          fixture: 4 wallets with keys, Chogs and ERC-20s; intent and signing helpers
├── OnDealIntents.settle.t.sol     pairs, surplus, 10-asset swaps, rings of 2–4, rotation, events
├── OnDealIntents.reverts.t.sol    every error, want coverage, moved/revoked assets, atomic failure, per-token NFT approvals
├── OnDealIntents.signatures.t.sol EIP-712 digest checked against the spec, wrong key/contract/chain, malleability, ERC-1271 wallets
├── OnDealIntents.nonces.t.sol     replay, invalidation, word boundaries, per-maker bitmap
├── OnDealIntents.tokens.t.sol     fee / lying / no-return / blocklist tokens, re-entry through a token hook
├── OnDealIntents.fuzz.t.sol       rings of any size and rotation pay exactly `give` and receive at least `want`
├── OnDealIntents.gas.t.sol        worst-case ring (4 × 10 NFTs), with and without the fee
├── OnDealIntents.fee.t.sol        the protocol fee (ADR 0015), signed as a maximum (ADR 0018)
├── DeployIntents.t.sol            deploy script: fee from config and env, MockWMON vs a given fee token, refusals, other chains
└── invariant/                       handler + invariants N1, N2, N5, N6 and conservation
```

`test/intents/` holds 99 tests plus the invariant suite (fuzz at 1000 runs, invariants at 256 runs × depth 64). Coverage on `OnDealIntents.sol` is 100% of lines, statements, branches and functions. Slither has not been run on it yet.

Protocol fee: every maker in a settled cycle pays the current `fee()` of `FEE_TOKEN` straight to the recipient, so the contract still holds nothing. `FEE_TOKEN` is trusted to be a plain wrapped-MON token (no issuer, no pause, no blocklist, so it can't be used to block settlements, and no transfer fee: unlike a `give`, the fee transfer has no balance-delta check); the deployer picks it once and it can't change. Each intent signs `maxFee`, so a signature carries consent to at most that amount, whatever the fee admin does later ([ADR 0018](adr/0018-adjustable-protocol-fee.md)). `OnDealIntents.fee.t.sol` (27 tests) covers every maker charged once, rings of 3 and 4, a maker who also gives WMON, a `maxFee` above the fee paying only the fee, one below it or another token refused, a cut settling old intents at the new fee, a queued raise changing nothing until applied, an applied raise making old intents stale, a maker without balance or allowance reverting the whole cycle with nothing moved or charged, replays, the zero fee and the constructor guards.

Invariants checked: **N1** the contract holds no native, ERC-20 or ERC-721 (and no fee token); **N2** a nonce settles at most once and never after it was invalidated; **N5** nothing settles after its deadline; **N6** the recipient holds exactly the fee in force at each settlement for every maker in it, nobody else paid, and nothing settles for a maker whose `maxFee` is below the fee (the handler changes the fee and signs `maxFee` below, at or above it); plus conservation (nothing is created or destroyed), which covers N3 and N4 for the handler's scenarios. N3 and N4 are also asserted directly in the unit and fuzz tests.

Known risk specific to this contract: a maker can spend an asset or revoke an approval after signing, which makes `settle` revert and costs the matcher gas. Nobody loses assets. Mitigation lives in the matcher (simulate right before sending), not the contract.

