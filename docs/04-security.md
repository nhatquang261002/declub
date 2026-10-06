# 04 · Security

`DeClubEscrow` holds other people's NFTs, ERC-20s and MON in escrow, and `DeClubIntents` moves assets straight between wallets under standing approvals. Every decision below is aimed at one guarantee:

> **Every escrowed asset has a deterministic path to settlement or refund. Nothing is ever locked forever.**

The trust model below covers both deal contracts. [`DeClubEscrow`](#declubescrow) and [`DeClubIntents`](#declubintents) each have their own invariants, threats and tests. The first contract, a Chog-only escrow (v1), was deleted in [ADR 0021](adr/0021-declub-pivot.md); its record is in git history.

## Trust model

| Actor | Can | Cannot |
|---|---|---|
| Maker | Create, cancel their own open trade, claim credited payouts | Change terms after creation; take back escrow after a fill |
| Taker | Fill an open, unexpired trade they're allowed to fill | Fill with the wrong assets or the wrong native amount; fill twice |
| Anyone | Reclaim an expired trade *to its maker* | Redirect a refund; cancel someone else's trade |
| Deployer | Nothing after deploy | Pause, upgrade or sweep (none of these exist), or change the fee recipient, the fee token or the fee ceiling (immutable) |
| Fee admin (`DeClubEscrow`, `DeClubIntents`) | Lower the fee at once, or queue a raise that takes effect only when it calls `applyFee` 7 days or more later (a newer `setFee` replaces the queued one), never above `MAX_FEE`; hand the role on in two steps, or renounce it for good ([ADR 0018](adr/0018-adjustable-protocol-fee.md)) | Change the fee of an escrow deal already listed, charge an intent more than its signed `maxFee`, raise the fee without the delay, or touch escrow, credits, nonces, the recipient or the token |
| Fee recipient | Receives the protocol fee when a deal completes | Touch escrow, take a fee for a deal that didn't complete, or change the fee |
| Rewards operator (`DeClubRewards`) | Publish an epoch's root with its MON, revoke it before claims open, sweep what's unclaimed after the claim window, hand the role on in two steps ([ADR 0022](adr/0022-club-rewards.md)) | Touch any deal, escrow or fee; take an epoch's MON back once claims are open (except the unclaimed rest after the window); make an epoch pay out more than it was funded with |

## Static analysis

`forge lint` is clean. Intentional patterns are suppressed inline with a reason, so any new finding stands out.

**Slither 0.11.4 on everything** (`slither . --filter-paths "lib/|test/|script/|src/mocks/"`, run 2026-10-03 over `DeClubEscrow`, `DeClubIntents`, `FeeAdmin` and the since-deleted v1) returned 102 results, none of them a bug. The rows for v1 are left out:

| Detector | Impact | Where | Verdict |
|---|---|---|---|
| `arbitrary-send-erc20` ×3 | High | `DeClubIntents._send`, `_chargeFees` | **False positive.** `from` is always a maker in the cycle whose signature `settle` checked, and whose nonce it used up, before any asset moves. The signature covers every `give` and the fee token and `maxFee`. |
| `arbitrary-send-eth` | High | `DeClubEscrow._transferOut` | **False positive.** `to` is the maker, taker, proposer or fee recipient that the trade names; a failed send becomes a credit. |
| `reentrancy-eth` ×8 | High | `DeClubEscrow` fill, accept, reject, withdraw, cancel, reclaim | **False positive**: every entry point is `nonReentrant` (Slither doesn't model OZ 5's storage-slot guard), and the only state written after a call is a credit for a send that *failed*. Covered by the re-entry tests in `DeClubEscrow.tokens.t.sol` and `DeClubEscrow.offers.t.sol`. |
| `uninitialized-state` | High | `DeClubEscrow._proposals` | **False positive.** A mapping; entries are written in `propose`. |
| `missing-zero-check` | Low | `FeeAdmin.transferFeeAdmin` | Intended: a zero `next` cancels a pending handover. |
| `calls-loop` ×53, `timestamp` ×8 | Low | loops over a capped side; expiries and deadlines | Intended: sides are capped at 10 assets, one failing transfer must revert the whole deal, and deadlines are hours long. |
| `naming-convention` ×16, `low-level-calls` ×3, `cyclomatic-complexity` ×3 | Info | | `UPPER_CASE` immutables and constants, the deliberate `call`s in payouts, `_validateSide`. |

**Slither 0.11.6 on `DeClubRewards`** (`slither src/DeClubRewards.sol --filter-paths lib/`, run 2026-10-06) returned 15 results, none of them a bug:

| Detector | Impact | Where | Verdict |
|---|---|---|---|
| `incorrect-equality` | Medium | `_published` | Intended: a zero root means "not published". `publish` refuses a zero root (`EmptyRoot`), so it can't be confused with a real one. |
| `missing-zero-check` | Low | `transferOperator` | Intended: a zero `next` cancels a pending handover, as in `FeeAdmin`. |
| `calls-loop` | Low | `claimMany` → `_send` | Intended: a batch is all or nothing, and each payee is a leaf's own account. One account refusing MON fails only that batch; its leaves can be claimed without it. |
| `timestamp` ×4 | Low | `revoke`, `sweep`, `_claim` (the fourth is the zero-root check above, misread) | Intended: the claim delay and window are hours to days long, so validator skew doesn't matter. |
| `low-level-calls`, `naming-convention` ×7 | Info | `_send`; immutables and constants | The deliberate MON `call` (a refusal reverts with `PayoutFailed`); `UPPER_CASE` immutables and constants. |

**Halmos** proves the core settlement property symbolically (`test/intents/symbolic/`, see [DeClubIntents](#declubintents)).

Before any mainnet deploy: an external review, a re-run of Slither and Halmos (triaged as above), and a public testnet period.

## `DeClubEscrow`

Design: [ADR 0005](adr/0005-generic-asset-model.md). On top of the trust model above, open offers ([ADR 0007](adr/0007-open-offers.md)) add:

| Actor | Can | Cannot |
|---|---|---|
| Proposer | Escrow a proposal on an open offer it may answer (anyone, or only the named `taker`); withdraw an `Active` proposal at any time, whatever the trade's state | Change a proposal after `propose`; propose on its own offer or after expiry; have it settled without the maker's `acceptProposal` |
| Maker (open offer) | Reject an `Active` proposal while the trade is open (also after expiry); accept one until expiry | Take a proposal's assets without settling the offer; touch the other proposals, which stay `Active` after an accept until their proposers withdraw them |

The differences that matter:

### Invariants

Recomputed from the trades themselves in `test/escrow/invariant/`, over native, two ERC-20s (one with a blocklist that the handler toggles) and NFTs, with a MON-rejecting actor.

| # | Invariant |
|---|---|
| V1 | `address(swap).balance == Σ native offered by Open trades + Σ native credits`. |
| V2 | For every ERC-20 the escrow holds: `balanceOf(swap) == Σ offered amount over Open trades + Σ credits`. |
| V3 | The escrow owns an NFT if and only if an Open trade offers it. |
| V4–V5 | Statuses only move `None → Open → {Filled, Cancelled}` and never leave a terminal state; `tradeCount` only increases and every id up to it exists. |
| V6 | No fill after expiry. |
| V7 | A fill or refund leaves each party holding (balance + credit) exactly what the terms say, and a reclaim caller who isn't the maker gets nothing. |
| V8 | `fillTrade` never settles an open offer, and every valid proposal call succeeds. |
| Liveness | A fill the taker can pay, and any cancel by the maker, never reverts, even with a blocklisted recipient. An expired open trade can always be reclaimed. |

**Protocol fee** ([ADR 0015](adr/0015-protocol-fee.md), [ADR 0018](adr/0018-adjustable-protocol-fee.md)). The invariant suite starts with a 3 MON fee (ceiling 12), a fee recipient that sometimes rejects MON, and a fee admin that changes the fee during the run, so trades carry different fees. V1 becomes `balance == Σ native offered by Open trades + each Open trade's own fee, once for the trade and once per Active proposal + Σ native credits` (the recipient's credit included), and **V9** says the recipient holds exactly `2 × the trade's fee` per completed deal (a fill or an accepted proposal), as MON or as a credit, and nothing for a deal that was cancelled, reclaimed, rejected or withdrawn. Refunds and releases are checked per call in the handler, at the trade's own fee. The fee suite (`DeClubEscrow.fee.t.sol`, 37 tests) covers the exact `msg.value` on every payable entry, release on fill and accept, refund on cancel, reclaim, reject and withdraw (also after the offer ended), a deal listed before a raise or a cut that fills, proposes and refunds at its own fee, a recipient that rejects MON or tries to re-enter, the zero fee and the constructor guards.

**Fee admin** (`FeeAdmin.t.sol`, 24 tests, run against both contracts): a cut applies at once and drops a queued raise, a raise only applies through `applyFee` after exactly 7 days and within the 7 days after that (`FeeRaiseExpired` once stale, so an old notice can't be used months on), a newer one restarts the clock, never above the ceiling, the two-step handover and its cancellation, renounce dropping any queued raise or handover, a zero admin at deploy, and everything a stranger or the recipient is refused. A fuzz test checks that the fee never exceeds the ceiling and never rises without the full delay.

Mutation checks: removing the credit on a failed payout, redirecting reclaimed assets to the caller, and allowing fills after expiry each make the invariant suite fail.

**Hostile collections** (`DeClubEscrow.hostile.invariant.t.sol`). A second invariant suite runs V3 against collections built to cheat: a `SoftNft` whose `transferFrom` does nothing, instead of reverting, when the move isn't allowed (so only the contract's own `ownerOf` checks stop it), a `LyingNft` that never moves anything, and type confusion (USDC sent as an ERC-721, an NFT sent as an ERC-20). Honest trades, open offers, proposals, fills, accepts, withdrawals and cancels run alongside attempts to deposit another actor's id, deposit an id already in escrow, deposit a `LyingNft`, fill a trade with an id the taker doesn't hold, or fill an ask that includes a `LyingNft`. Each call knows whether it's honest: an honest one must succeed and land where the terms say, a hostile one must revert. Invariants: the escrow owns a `SoftNft` id exactly when one open trade or `Active` proposal holds it (never two), never holds a `LyingNft` or a type-confused asset, and holds exactly the USDC and fee shares it accounts for. Removing either the `ownerOf == from` check in `_moveNft` or the "an ERC-20 must not be an NFT" check makes it fail within one run (the second lets "1 unit" of an NFT collection pull NFT #1 into escrow).

### Threats

| Threat | Mitigation | Test |
|---|---|---|
| **Double fill / double refund** | Status is checked and set to a terminal value *before* any external call; `nonReentrant` on every mutating function | `test_revertsWhenFilledTwice`, `test_cancelRevertsAfterFillCancelOrUnknown`, `test_acceptTwiceReverts` |
| **Unauthorised cancel or taker** | `msg.sender == maker` to cancel; `taker != 0 → msg.sender == taker` to fill or propose; no self-fill | `test_cancelRevertsForNonMaker`, `test_directRequestOnlyForNamedTaker`, `test_revertsSelfFill`, `testFuzz_onlyMakerCancelsAndOnlyNamedTakerFills` |
| **Fill after expiry** | `TradeIsExpired` on fill, propose and accept | `test_expiryBoundary`, `testFuzz_expiryBoundary`, `test_acceptRevertsAfterExpiry` |
| **Assets locked by an unresponsive party** | The taker's side is never escrowed. The maker can cancel at any time, anyone can reclaim to the maker after expiry, and a proposer can always withdraw | `test_cancelWorksAfterExpiry`, `test_withdrawWorksAfterCancelAndAfterExpiry`, liveness invariant |
| **Maker front-runs a fill by cancelling** | Allowed and harmless: the fill reverts with `TradeNotOpen` and the taker only loses gas | `test_cannotFillCancelled` |
| **Terms swapped under the taker** | Terms, and the fee a deal was listed with, never change after creation | V7, `DeClubEscrow.fee.t.sol` |
| **Stray deposits** | No `receive()`, `fallback()` or `IERC721Receiver`, so plain MON sends and `safeTransferFrom` into the contract revert | `test_rejectsDirectMon`, `test_rejectsSafeTransferOfNft` |
| **Fee-on-transfer / rebasing / lying ERC-20** breaks escrow accounting | Balance-delta check on every ERC-20 deposit (`UnsupportedToken`) | `test_feeOnTransferTokenIsRejectedAsOffered`, `test_tokenThatLiesAboutTransferIsRejected` |
| **Lying ERC-721** | Every NFT move, the maker's deposit and the taker's side of a fill, checks `ownerOf(id) == from` before and `== to` after (`NftNotReceived`). The check after alone isn't enough: with a collection whose `transferFrom` silently does nothing, a taker could fill without the NFT, and an id already in escrow could be listed again and cancelled out. | `test_nftThatLiesAboutTransferIsRejected`, `test_fillWithAnNftTheTakerDoesNotOwnReverts`, `test_fillWithAnNftThatNeverMovesReverts`, `test_anEscrowedNftCannotBeListedTwice` |
| **Asset type confusion** (ERC-20 and ERC-721 `transferFrom` share a selector: "6 units" of an ERC-20 at an NFT collection pulls NFT #6) | ERC-165: `ERC721` and trait assets must support `IERC721`, `ERC20` assets must not (`InvalidAsset`) | `test_anNftCollectionCannotBeAskedForAsAnErc20`, `test_anErc20CannotBeAskedForAsAnNft` and two more |
| **Blocklisted recipient (USDC-style) locks a refund or fill** | Payouts out of escrow never revert: they become credits for `claim` | `DeClubEscrow.claim.t.sol` (native, ERC-20, ERC-721; fill, cancel, reclaim) |
| **Token hook re-enters** (ERC-777 style) | `nonReentrant` on every mutating function, including `claim` | `test_tokenHookCannotReenterDuring{Deposit,Fill,Cancel}`, `test_nativeReceiver*` |
| **USDT-style token with no return value** | `SafeERC20` | `test_noReturnTokenWorksOnBothSides` |
| **Unfillable trade** (same asset both sides, duplicates) | Rejected at creation | `test_revertsSameAssetOnBothSides`, `test_revertsDuplicateAssetOnOneSide` |
| **Partial fill** | One asset failing reverts the whole fill | `test_fillIsAtomic` |
| **Unbounded gas per trade** | `MAX_ASSETS_PER_SIDE = 10`; worst case measured at 2.2M create / 0.9M fill | `test_worstCaseGas` |

### Accepted limitations

- **Any token can be listed.** A scam token only hurts whoever fills a trade that names it. The UI has to show the on-chain symbol, decimals and address.
- **A fee-charging token can still be *requested*.** The maker receives less than the listed amount. It's their own choice of token.
- **A permanently blocked recipient** (the token itself blacklists them) keeps the credit in the escrow forever. The escrow can't do more than offer the claim.
- **Gas-burning token or receiver.** One that burns all forwarded gas can make fills of *its own* trades fail. Takers lose gas, nobody loses assets.
- **Approvals.** The app approves each ERC-20 to `DeClubEscrow` for the exact amount of the deal, not unlimited, and each NFT collection with `setApprovalForAll` (the only way to cover several ids in one transaction; `web/hooks/useAssetApprovals.ts`). For signed swaps it approves `DeClubIntents` for the exact ERC-20 amount (plus the fee), and each NFT on its own with `approve(id)` unless the maker chooses to approve the whole collection (`web/hooks/useIntentReadiness.ts`). The app has no revoke button.
- **A compromised fee admin** can raise the fee to `MAX_FEE` after 7 days' public notice (`FeeChangeQueued`, then `applyFee`), or cut it to zero at once. The contract accepts any ceiling up to `MAX_FEE_LIMIT` (500 MON), and the deploy scripts take whatever `PROTOCOL_FEE_MAX_WEI` says (they refuse to guess one), so check `MAX_FEE()` on the deployed contract. It can't touch a deal already listed, charge an intent more than its `maxFee`, or move anyone's assets. Keep the admin Safe's signers apart from the recipient's, and watch for `FeeChangeQueued` ([ADR 0018](adr/0018-adjustable-protocol-fee.md)).
- No external review yet.

### Test suite

```text
contracts/test/escrow/
├── DeClubEscrowBase.sol            fixture: 3 wallets with Chogs, two ERC-20s and MON; asset builders
├── DeClubEscrow.create.t.sol       every validation error, escrow of each asset type, event, max size
├── DeClubEscrow.fill.t.sol         every type pairing, mixed bundles, atomicity, boundaries, worst-case gas
├── DeClubEscrow.cancel.t.sol       cancel and reclaim: refunds, access control, states
├── DeClubEscrow.claim.t.sol        rejected payouts become credits: native, ERC-20, ERC-721
├── DeClubEscrow.tokens.t.sol       fee / lying / no-return tokens, re-entry, stray deposits
├── DeClubEscrow.fuzz.t.sol         conservation, exact refunds, wrong value, expiry boundary, access
├── DeClubEscrow.fee.t.sol          the protocol fee (ADR 0015), fixed per deal across changes (ADR 0018)
├── DeClubEscrow.offers.t.sol       open offers: notes, propose / withdraw / reject / accept rules, paging, re-entry
├── DeClubEscrow.traits.t.sol       trait requests: field and spec rules, proofs (one built by the web app), fills, refunds
├── invariant/                    handler + invariants V1–V9, proposal statuses and liveness;
│                                 HostileHandler + V3 and accounting against hostile collections
├── DeployEscrow.t.sol, MockERC20.t.sol
contracts/test/utils/WeirdTokens.sol   fee, lying, soft, no-return, blocklist and hook tokens
```

`test/escrow/` holds 202 tests plus the two invariant suites (unit, fuzz at 1000 runs, invariants at 256 runs × depth 64). Coverage on `DeClubEscrow.sol` is 100% of lines, statements, branches and functions.

## DeClubIntents

[ADR 0008](adr/0008-trade-intents.md) and [0009](adr/0009-ring-swaps.md). Standing approvals make this contract more sensitive than the escrow ones, so it has no admin beyond the fee amount, no arbitrary calls and no way to move an asset without a valid unexpired signature from its owner.

```text
contracts/test/intents/
├── DeClubIntentsBase.sol          fixture: 4 wallets with keys, Chogs and ERC-20s; intent and signing helpers
├── DeClubIntents.settle.t.sol     pairs, surplus, 10-asset swaps, rings of 2–4, rotation, events
├── DeClubIntents.reverts.t.sol    every error, want coverage, moved/revoked assets, atomic failure, per-token NFT approvals
├── DeClubIntents.signatures.t.sol EIP-712 digest checked against the spec, wrong key/contract/chain, malleability, ERC-1271 wallets
├── DeClubIntents.nonces.t.sol     replay, invalidation, word boundaries, per-maker bitmap
├── DeClubIntents.tokens.t.sol     fee / lying / no-return / blocklist tokens, re-entry through a token hook
├── DeClubIntents.fuzz.t.sol       rings of any size and rotation pay exactly `give` and receive at least `want`
├── DeClubIntents.gas.t.sol        worst-case ring (4 × 10 NFTs), with and without the fee
├── DeClubIntents.fee.t.sol        the protocol fee (ADR 0015), signed as a maximum (ADR 0018)
├── DeployIntents.t.sol            deploy script: fee from config and env, MockWMON vs a given fee token, WMON check, refusals, other chains
├── invariant/                       handler + invariants N1, N2, N5, N6 and conservation;
│                                    HostileHandler + N1, conservation and settlement against hostile collections
└── symbolic/                        Halmos: every pair and 3-ring pays every want (run with halmos, not forge)
```

`test/intents/` holds 104 tests plus the two invariant suites (fuzz at 1000 runs, invariants at 256 runs × depth 64). Coverage on `DeClubIntents.sol` is 100% of lines, statements, branches and functions. Slither is triaged [above](#static-analysis).

**Hostile collections** (`DeClubIntents.hostile.invariant.t.sol`). Signed pairs and 3-rings where each give is either honest or hostile: a `SoftNft` id the receiver already owns, one a third actor owns, one whose maker revoked approval (so `SoftNft` silently refuses), a `LyingNft`, USDC given as an ERC-721 or an NFT given as an ERC-20. Every maker signs, so the signature never stops a bad cycle; the contract's checks have to. Honest cycles must settle and leave every NFT with the next maker and every USDC balance exact; hostile ones must revert. Invariants: the contract holds nothing, `LyingNft` ids never move, and USDC is conserved. Removing the `ownerOf == from` check in `_send` makes it fail within one run.

**Symbolic check** (`test/intents/symbolic/DeClubIntents.halmos.t.sol`, `FOUNDRY_DYNAMIC_TEST_LINKING=false halmos --match-contract DeClubIntentsSymbolic --loop 4`). For every pair and every 3-ring of single-asset ERC-20 intents, with every amount and every token choice symbolic (so every rotation, mismatch and short give), Halmos 0.3.3 proves that `settle` either reverts or leaves each maker with at least its `want` and exactly its `give` paid, and the contract with nothing: 445 paths for the pair, 4,082 for the ring, about 100 s. Makers are ERC-1271 wallets that accept any signature, so the solver doesn't model `ecrecover`; signatures have their own suite. Changing `>=` to let a give 1 wei short through gives a counterexample (`g1 = w0 − 1`).

Protocol fee: every maker in a settled cycle pays the current `fee()` of `FEE_TOKEN` straight to the recipient, so the contract still holds nothing. `FEE_TOKEN` is trusted to be a plain wrapped-MON token (no issuer, no pause, no blocklist, so it can't be used to block settlements, and no transfer fee: unlike a `give`, the fee transfer has no balance-delta check); the deployer picks it once and it can't change. Each intent signs `maxFee`, so a signature carries consent to at most that amount, whatever the fee admin does later ([ADR 0018](adr/0018-adjustable-protocol-fee.md)). `DeClubIntents.fee.t.sol` (27 tests) covers every maker charged once, rings of 3 and 4, a maker who also gives WMON, a `maxFee` above the fee paying only the fee, one below it or another token refused, a cut settling old intents at the new fee, a queued raise changing nothing until applied, an applied raise making old intents stale, a maker without balance or allowance reverting the whole cycle with nothing moved or charged, replays, the zero fee and the constructor guards.

Invariants checked: **N1** the contract holds no native, ERC-20 or ERC-721 (and no fee token); **N2** a nonce settles at most once and never after it was invalidated; **N5** nothing settles after its deadline; **N6** the recipient holds exactly the fee in force at each settlement for every maker in it, nobody else paid, and nothing settles for a maker whose `maxFee` is below the fee (the handler changes the fee and signs `maxFee` below, at or above it); plus conservation (nothing is created or destroyed), which covers N3 and N4 for the handler's scenarios. N3 and N4 are also asserted directly in the unit and fuzz tests.

The same two token checks as `DeClubEscrow` apply: asset types must match ERC-165 (`test_anNftCollectionCannotBeAnErc20`, `test_anErc20CannotBeAnNft`), and an NFT `give` checks `ownerOf` before as well as after the move, so a collection that ignores an unauthorised transfer can't pass off an id the receiver already owns (`test_anNftTheReceiverAlreadyOwnsIsRefused`).

Known risk specific to this contract: a maker can spend an asset or revoke an approval after signing, which makes `settle` revert and costs the matcher gas. Nobody loses assets. Mitigation lives in the matcher (simulate right before sending), not the contract.

## `DeClubRewards`

Design: [ADR 0022](adr/0022-club-rewards.md); behaviour in [03 · Contract Design](03-contract-design.md#declubrewards-club-rewards). It holds only MON, and only what published epochs still owe. Its guarantee:

> **No epoch pays out more than it was funded with, no leaf is paid twice, and once claims open only the leaves can take an epoch's MON until its window ends.**

The root itself is trusted: the operator builds it off chain from the server's memberships and activity, and the contract can't tell a right root from a wrong one. What bounds a wrong root is the claim delay (the operator can revoke before claims open), the per-epoch cap (a wrong root can't reach other epochs' MON) and the public epoch data (`/api/rewards/epochs/<n>`, so anyone can rebuild and compare the root).

### Invariants

`test/rewards/invariant/` runs random publish, claim, revoke, sweep and time jumps over four Holders, with some roots deliberately underfunded (the leaves promise twice what was sent), and keeps its own books:

| # | Invariant |
|---|---|
| R1 | The contract's balance is exactly what its open epochs still owe: Σ (`total` − `claimed`) over epochs not revoked or swept. |
| R2 | No epoch's `claimed` exceeds its `total`. |
| R3 | No leaf is paid twice. |
| R4 | Every wei that went in and wasn't revoked went to a Holder, was swept, or is still held. |
| Calls | Every call did what the handler's books say: a valid claim, revoke or sweep succeeded and paid the exact amount, and an invalid one reverted. Violations are counted, not asserted in the handler, so a bad call can't be dropped by the fuzzer as a revert. |

Mutation checks: removing the over-claim check, letting a revoke through after claims open, and sweeping the whole total instead of the unclaimed rest each make the suite fail; dropping the claimed flag fails R3.

### Threats

| Threat | Mitigation | Test |
|---|---|---|
| **A wrong or malicious root** drains other epochs | Each epoch keeps its own `total` and `claimed`; a claim past `total` reverts with `OverClaim` | `test_aRootThatPromisesTooMuchCanOnlyPayItsOwnFunding`, R1, R2 |
| **A wrong root is published** | `CLAIM_DELAY` (a day on mainnet) before claims open, during which `revoke` refunds it in full | `test_revokeRefundsInFullAndFreesTheEpoch`, `test_revokeIsTooLateOnceClaimsOpen` |
| **Double claim** | A claimed flag per (epoch, account), set before the send | `test_eachLeafPaysItsAccountOnce`, `test_claimManyIsAllOrNothing`, R3 |
| **Proof replay** across epochs, deployments or chains | The leaf hashes the chain id, the contract and the epoch | `test_aProofIsBoundToItsEpoch`, `test_aProofIsBoundToItsDeploymentAndChain` |
| **Second-preimage** (an inner node passed off as a leaf) | Leaves are hashed twice, so they never have an inner node's shape | `test_aLeafIsHashedTwiceAndBoundToChainAndContract` |
| **Re-entry from a payout** | `nonReentrant` on every entry point; state written before the send | `test_aClaimCannotReenter` |
| **A claim sent for someone else** | Allowed: the MON always goes to the leaf's account | `test_anyoneCanClaimButTheMonGoesToTheAccount` |
| **The operator takes the MON** | Only before claims open (`revoke`) or the unclaimed rest after `CLAIM_WINDOW` (`sweep`); the window is fixed at deploy and at least a day | `DeClubRewards.close.t.sol`, `testFuzz_delayBoundary` |
| **The web builder and the contract disagree** on the leaf | A root built by `web/lib/rewards.ts` is verified and paid by the contract in a fixture test | `DeClubRewards.leafFixture.t.sol`, `web/test/rewards.test.ts` |

### Accepted limitations

- **The operator is trusted for correctness.** It decides who is paid; the contract only bounds the damage. On mainnet it is a Safe (`DeployRewards.s.sol` refuses an EOA there).
- **Holdings are read when the epoch is built**, not at a fixed block. Borrowing NFTs around that moment is possible; the reward at stake is a fraction of fees.
- **An account that refuses MON** can't be paid until it accepts it; its leaf stays claimable until the epoch is swept.
- No external review yet.

### Test suite

```text
contracts/test/rewards/
├── DeClubRewardsBase.sol            fixture: operator, Holders, a sorted-pair tree builder, a MON refuser, a re-entrant claimer
├── DeClubRewards.publish.t.sol      constructor bounds, publish rules and event, plain MON refused, the operator handover
├── DeClubRewards.claim.t.sol        paying each leaf once, anyone claiming, claimMany, the delay, wrong proofs, replay, over-claim, refusals, re-entry
├── DeClubRewards.close.t.sol        revoke before claims open, sweep after the window, closed epochs
├── DeClubRewards.fuzz.t.sol         any set of leaves pays exactly, no other amount, the delay boundary, operator-only
├── DeClubRewards.leafFixture.t.sol  a root built by the web app pays
├── DeployRewards.t.sol              the deploy script, env defaults, mainnet rules
└── invariant/                       handler + R1–R4 and every call behaving
```

`forge coverage`: 100% of lines, statements, branches and functions on `DeClubRewards.sol`. Slither is triaged [above](#static-analysis).

