# 03 · Contract Design

The app uses three contracts. The two deal contracts inherit one fee module; the third pays Club rewards.

| Contract | Interface (source of truth) | What it does |
|---|---|---|
| [`DeClubEscrow`](../contracts/src/DeClubEscrow.sol) | [`IDeClubEscrow.sol`](../contracts/src/interfaces/IDeClubEscrow.sol) | Locked deals. The maker's side sits in escrow until a taker fills it. Any ERC-721, ERC-20 and MON, in any mix; exact, trait and open-offer deals. |
| [`DeClubIntents`](../contracts/src/DeClubIntents.sol) | [`IDeClubIntents.sol`](../contracts/src/interfaces/IDeClubIntents.sol) | Signed swaps. No escrow: pairs and rings of up to 4 settle wallet to wallet when anyone (the matcher) submits them. |
| [`FeeAdmin`](../contracts/src/FeeAdmin.sol) | [`IFeeAdmin.sol`](../contracts/src/interfaces/IFeeAdmin.sol) | The protocol fee amount, shared by both. |
| [`DeClubRewards`](../contracts/src/DeClubRewards.sol) | [`IDeClubRewards.sol`](../contracts/src/interfaces/IDeClubRewards.sol) | Club rewards: each epoch's payouts, funded by the operator and claimed against a Merkle root ([below](#declubrewards-club-rewards)). |

The app reads `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS`, `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` and `NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS` (`web/lib/config.ts`, `web/lib/contracts.ts`). The old "Phase 4" sketch of generalized assets and ring swaps was built as these two contracts ([ADR 0005](adr/0005-generic-asset-model.md), [ADR 0008](adr/0008-trade-intents.md), [ADR 0009](adr/0009-ring-swaps.md)).

## DeClubEscrow (locked deals)

Reasoning: [ADR 0005](adr/0005-generic-asset-model.md) (generic assets), [ADR 0006](adr/0006-trait-requests-in-v2.md) (traits), [ADR 0007](adr/0007-open-offers.md) (open offers). Its constructor takes only the protocol fee settings: the fee, its ceiling, where it goes and who may change it (see [Protocol fee](#protocol-fee-declubescrow)).

```solidity
enum Status { None, Open, Filled, Cancelled }
enum AssetType { Native, ERC20, ERC721, ERC721Trait }
struct Asset { AssetType assetType; address token; uint256 id; uint256 amount; }
struct Trade { address maker; uint64 expiry; Status status; address taker; uint96 fee; Asset[] offered; Asset[] requested; }
struct TraitFill { uint256[] tokenIds; bytes32[][] proofs; }
enum ProposalStatus { None, Active, Accepted, Withdrawn, Rejected }
struct Proposal { address proposer; ProposalStatus status; Asset[] assets; }
```

A trade moves `Open → Filled | Cancelled` and never leaves a terminal state. Expiry is derived from `expiry` (0 = never), never stored as a status: an expired trade is still `Open` until the maker cancels it or anyone reclaims it for the maker. `fee` is the fee in force when the trade was created. There are three kinds of deal:

| Kind | Created with | `requested` | Settled by |
|---|---|---|---|
| Exact | `createTrade` | exact assets | `fillTrade` |
| Trait | `createTraitTrade` | at least one `ERC721Trait` asset, plus any others | `fillTraitTrade` |
| Open offer | `createOpenOffer` | empty | `acceptProposal`, never `fillTrade` |

An `ERC721Trait` asset keeps the Merkle root of the allowed ids in `id`, and in `amount` (1–10) how many of them the taker hands over. The set's size never goes on-chain. Each leaf is `keccak256(abi.encode(token, tokenId))` in a sorted-pair tree (OpenZeppelin `MerkleProof`), so roots are collection-scoped.

On an open offer, takers escrow proposals and the maker accepts one. Proposal ids count from 0 within each trade. A proposal moves `Active → Accepted | Withdrawn | Rejected` and never changes its assets.

### DeClubEscrow functions

| Function | What it does |
|---|---|
| `createTrade(offered, requested, taker, expiry) payable` | Validates both sides, then pulls every offered asset into escrow. `msg.value` must equal the native amount in `offered` plus `fee()`. |
| `createTraitTrade(offered, requested, taker, expiry, spec) payable` | `createTrade` for a `requested` side with `ERC721Trait` assets. `spec` (1–1024 bytes) describes the sets for clients and is stored. [ADR 0006](adr/0006-trait-requests-in-v2.md). |
| `createOpenOffer(offered, taker, expiry, note) payable` | Escrows `offered` with no ask. `msg.value` as for `createTrade`. `note` (0–280 bytes) tells proposers what the maker is after and binds nobody. A non-zero `taker` is the only address that may propose. |
| `fillTrade(id) payable` | `msg.value` must equal the native amount in `requested` plus the trade's `t.fee`. Requested assets go taker → maker (a failure reverts the fill); every offered asset goes escrow → taker; both fee shares go to `FEE_RECIPIENT`. |
| `fillTraitTrade(id, fills) payable` | `fillTrade` for a trade with trait assets: `fills[k]` is `{tokenIds, proofs}` for the k-th trait asset. Also fills a trade with none, given no `fills`. `fillTrade` reverts with `TraitFillRequired` on a trait trade. |
| `propose(id, assets) payable` | Escrows `assets` as a proposal on an open offer. `msg.value` = native amount in `assets` + `t.fee`. Returns the proposal id. |
| `withdrawProposal(id, proposalId)` | Proposer takes an `Active` proposal back, at any time, whatever the trade's state. |
| `rejectProposal(id, proposalId)` | Maker sends an `Active` proposal back to its proposer while the trade is open. |
| `acceptProposal(id, proposalId)` | Maker settles the open offer: the proposal's assets go to the maker and the escrow to the proposer; both held fee shares go to `FEE_RECIPIENT`. Not payable. Other proposals stay `Active` for their proposers to withdraw. |
| `cancelTrade(id)` | Maker, while open (expired or not). Refunds the offered side and the maker's fee share to the maker. |
| `reclaimExpired(id)` | Anyone, once expired. Refunds to the maker. |
| `claim(assetType, token, id)` | Collect a payout that was rejected earlier. |
| `getTrade`, `isExpired`, `tradeCount`, `traitSpec(id)`, `offerNote(id)`, `proposalCount(id)`, `getProposal(id, proposalId)`, `getProposals(id, offset, limit)`, `claimable(account, assetType, token, id)`, `MAX_ASSETS_PER_SIDE` (10), `MAX_SPEC_BYTES` (1024), `MAX_NOTE_BYTES` (280), plus the [`FeeAdmin`](#feeadmin) views | Views. `getTrade(id).fee` is the fee that trade was listed with. `getProposals` returns proposals `offset .. offset + limit - 1`, clamped to what exists. |

### Create-time checks

| Check | Error |
|---|---|
| a side is empty (the offered side; and `requested` for `createTrade` / `createTraitTrade`) | `EmptySide` |
| more than 10 assets on a side | `TooManyAssets(count, max)` |
| field rules per type (see the ADR): native has no token/id, ERC-20 has a contract that doesn't report `IERC721` over ERC-165 and no id, ERC-721 has a contract that does and amount 1, amounts > 0 | `InvalidAsset(index)` |
| same `(type, token, id)` twice on a side | `DuplicateAsset(index)` |
| same `(type, token, id)` on both sides | `SameAssetBothSides(i, j)` |
| trait asset on the offered side, in a proposal, or via `createTrade`; zero root, zero or > 10 `amount`, or a token that isn't an ERC-165 `IERC721` | `InvalidAsset(index)` |
| `createTraitTrade` without a trait asset / with an empty or oversized spec | `NoTraitAsset` / `BadTraitSpec(length, max)` |
| `createOpenOffer` note over 280 bytes | `NoteTooLong(length, max)` |
| `msg.value` ≠ native amount offered + `fee()` | `WrongNativeAmount(expected, sent)` (`expected` includes the fee) |
| `expiry` in the past | `ExpiryInPast` |
| ERC-20 deposit delivered a different amount | `UnsupportedToken(token)` |
| NFT not owned by the sender before the transfer, or by the receiver after it (the maker's deposit and the taker's side of a fill) | `NftNotReceived(token, id)` |

### Fill, proposal and claim checks

| Call | Reverts with |
|---|---|
| `fillTrade`, `fillTraitTrade` | `TradeNotOpen`, `OpenOfferNoFill` (an open offer), `TradeIsExpired`, `NotAllowedTaker`, `SelfFill`, `WrongNativeAmount` (native requested + `t.fee`). Trait trades: `TraitFillRequired` from `fillTrade`; `InvalidTraitFill(fillIndex)` (wrong number of fills, ids or proofs, or a repeated id) and `InvalidTraitProof(fillIndex, tokenId)` from `fillTraitTrade`. All proofs are checked before anything moves; owning the ids is proven by the transfer. |
| `propose` | `TradeNotOpen`, `NotOpenOffer` (the trade has an ask), `TradeIsExpired`, `NotAllowedTaker`, `SelfPropose`; the offered-side rules above (no trait assets); `SameAssetBothSides` against the offer; `WrongNativeAmount` (native proposed + `t.fee`); `UnsupportedToken` / `NftNotReceived` on deposit. |
| `withdrawProposal` | `UnknownProposal`, `NotProposer`, `ProposalNotActive`. No check on the trade: it works while the offer is open, after it expired, and after it was cancelled or filled. |
| `rejectProposal` | `TradeNotOpen`, `NotMaker`, `UnknownProposal`, `ProposalNotActive`. No expiry check, so the maker can still reject after expiry while the trade is open. |
| `acceptProposal` | `TradeNotOpen`, `NotMaker`, `TradeIsExpired`, `UnknownProposal`, `ProposalNotActive`. |
| `cancelTrade` / `reclaimExpired` | `TradeNotOpen`, `NotMaker` / `TradeNotOpen`, `TradeNotExpired`. |
| `claim` | `NothingToClaim`, or `ClaimFailed` if the transfer fails again (the credit stays). |

### Payouts

```text
_payout(to, asset):                      // never reverts
    ok = transferOut(asset, to)          // native: call · ERC-20: trySafeTransfer · ERC-721: transferFrom
    if !ok: credits[to][key(type, token, id)] += amount; emit AssetCredited
```

`claim` zeroes the credit, emits `Claimed`, then transfers and reverts with `ClaimFailed` if that fails (which restores the credit). Every payout out of escrow takes this never-reverting path: fills, accepts, cancels, reclaims, rejects, withdrawals, fee releases and fee refunds.

### DeClubEscrow events

| Event | Emitted by |
|---|---|
| `TradeCreated(id, maker, taker, offered[], requested[], expiry)` | every create (`requested` is empty for an open offer) |
| `TraitSpec(id, spec)` | `createTraitTrade` |
| `OfferNote(id, note)` | `createOpenOffer`, only with a non-empty note |
| `TradeFilled(id, maker, taker)` | `fillTrade`, `fillTraitTrade`, `acceptProposal` (taker = the proposer) |
| `ProposalCreated(id, proposalId, proposer, assets[])` | `propose` |
| `ProposalWithdrawn(id, proposalId)`, `ProposalRejected(...)`, `ProposalAccepted(...)` | the matching call |
| `TradeCancelled(id, maker)`, `TradeReclaimed(id, maker, caller)` | `cancelTrade`, `reclaimExpired` |
| `AssetCredited(account, token, assetType, id, amount)`, `Claimed(...)` | a rejected payout, `claim` |
| `FeeCharged(id, recipient, amount)` | once per completed deal; not emitted when the fee is 0 |

Plus the [`FeeAdmin`](#feeadmin) events.

### Protocol fee (`DeClubEscrow`)

Reasoning: [ADR 0015](adr/0015-protocol-fee.md), [ADR 0018](adr/0018-adjustable-protocol-fee.md). `constructor(uint256 initialFee, uint256 maxFee, address feeRecipient, address admin)`. `FEE_RECIPIENT` and the ceiling `MAX_FEE` are immutable; the constructor refuses a ceiling above `MAX_FEE_LIMIT` (500 MON) or a fee above the ceiling (`FeeTooHigh`), and a non-zero ceiling without a recipient (`NoFeeRecipient`). A fee of 0 (tests, testnet) charges and emits nothing.

The fee amount is the one thing that can change ([`FeeAdmin`](#feeadmin), shared with `DeClubIntents`). The fee admin can `setFee` lower at once, or queue a raise that the admin makes live with `applyFee` once `FEE_RAISE_DELAY` (7 days) has passed, never above `MAX_FEE`. The role moves in two steps, and `renounceFeeAdmin` fixes the fee for good. A zero admin at deploy is a fixed fee.

**Each trade records `fee()` when it is created** (`Trade.fee`, a `uint96` packed beside `taker`), and both sides pay that recorded fee. A change never touches a deal already listed. Every side sends the trade's fee with its own call and the contract only **holds** it:

| Call | `msg.value` | The share |
|---|---|---|
| `createTrade`, `createTraitTrade`, `createOpenOffer` | native offered + `fee()` | the maker's, held with the trade, recorded as `t.fee` |
| `propose` | native proposed + `t.fee` | the proposer's, held with the proposal |
| `fillTrade`, `fillTraitTrade` | native requested + `t.fee` | the taker's, released at once with the maker's |
| `acceptProposal` | none (non-payable) | both held shares released |
| `cancelTrade`, `reclaimExpired` | none | the maker's share refunded to the maker |
| `rejectProposal`, `withdrawProposal` | none | the proposer's share refunded to the proposer |

A completed deal sends `2 × t.fee` to the recipient in one payout. Refunds return `t.fee`. Fee payouts and refunds go through `_payout`'s never-reverting path, so a recipient or a refund target that rejects MON gets a credit for `claim` and the deal still completes. Accounting: native balance = open native escrow + one `t.fee` per open trade and per active proposal + unclaimed credits.

### Gas (worst case: 10 NFTs each way)

Create **2.2M**, fill **0.9M**. A trade with one asset per side costs roughly 0.2–0.35M to create and 0.09–0.13M to fill.

## DeClubIntents (signed swaps)

Settles signed intents wallet to wallet, with no escrow ([ADR 0008](adr/0008-trade-intents.md), [ADR 0009](adr/0009-ring-swaps.md)). Spec in [`IDeClubIntents.sol`](../contracts/src/interfaces/IDeClubIntents.sol).

- `settle(Intent[] cycle, bytes[] signatures)`: anyone, 2 to `MAX_CYCLE = 4` intents (`BadCycleSize`), one signature each (`SignatureCountMismatch`). `cycle[i].give` is paid in full to `cycle[(i+1) % n].maker` and must cover that maker's `want`. Every nonce is consumed before any asset moves; the function is `nonReentrant`; any failure reverts everything.
- `invalidateNonces(word, mask)`: Permit2-style unordered nonces (bit `nonce & 0xff` of word `nonce >> 8`), so a maker can have many live intents and cancel any one.
- Signatures: EIP-712 (`DeClubIntents`, version `3`), ECDSA or ERC-1271; malleable signatures are refused (`BadSignature`). `Intent` is `(maker, give, want, feeToken, maxFee, deadline, nonce)`.
- Rules on every intent in a cycle:

  | Rule | Error |
  |---|---|
  | `maker` is not zero | `InvalidMaker(intent)` |
  | `deadline` is not zero, and not passed (`block.timestamp > deadline`) | `InvalidDeadline(intent)` / `IntentExpired(intent)` |
  | `feeToken == FEE_TOKEN` and `maxFee >= fee()` | `WrongFee(intent, feeToken, maxFee)` |
  | each side has 1 to `MAX_ASSETS_PER_SIDE = 10` assets | `EmptySide(intent, give)` / `TooManyAssets(intent, give, count)` |
  | only `ERC20` (contract that isn't an ERC-165 `IERC721`, id 0, amount > 0) and `ERC721` (`IERC721` contract, amount 1); `Native` is refused | `InvalidAsset(intent, give, index)` |
  | no asset twice on a side, none on both sides | `DuplicateAsset(intent, give, index)` / `SameAssetBothSides(intent)` |
  | valid signature, unused nonce, makers distinct within the cycle | `BadSignature(intent)` / `NonceUsed(maker, nonce)` / `DuplicateMaker(intent)` |
  | the previous maker's `give` covers this `want` | `WantNotMet(intent, wantIndex)` |

- `want` is a floor: ERC-20 amounts are minimums, NFTs are exact ids. Each `give` is paid in full, so anything beyond the next maker's `want` (a larger amount, extra assets) goes to that maker.
- The contract puts no upper bound on `deadline`. The pool only accepts deadlines 60 s to 7 days out; that's pool policy.
- Protocol fee ([ADR 0015](adr/0015-protocol-fee.md), [ADR 0018](adr/0018-adjustable-protocol-fee.md)): `constructor(feeToken, initialFee, maxFee, feeRecipient, admin)`. `FEE_TOKEN`, `FEE_RECIPIENT` and the ceiling `MAX_FEE` are immutable; the constructor reverts with `InvalidFeeToken` if the ceiling isn't 0 and the fee token isn't a contract. The amount, `fee()`, is set by the same [`FeeAdmin`](#feeadmin) as in `DeClubEscrow`. Each intent signs `feeToken` and `maxFee`, the most its maker pays. After every `give` has moved, each maker in the cycle pays the current `fee()` of `FEE_TOKEN` (wrapped MON) straight to `FEE_RECIPIENT`, and one `FeeCharged(recipient, token, n × fee)` is emitted. A cut keeps every signed intent valid and charges less; a raise makes the intents signed below it stale until they're signed again. A cycle that doesn't settle charges nobody, and a maker without the balance or approval reverts the whole cycle.
- ERC-20 gives only move if the receiver's balance rises by exactly the amount (fee-on-transfer and lying tokens revert with `UnsupportedToken`, as in V2); NFTs are checked with `ownerOf`, owned by the giver before and the receiver after (`NftNotReceived`). The fee transfer has no such check: `FEE_TOKEN` is trusted to be a plain wrapped-MON token.
- Native MON can't be pulled from a wallet (use WMON); trait sets are not supported yet.
- The contract never holds an asset (the fee goes from the maker's wallet to the recipient inside `settle`) and has no `receive()`. Its only admin is the fee admin, over the fee amount.
- Events: `IntentFilled(intentHash, maker, recipient, nonce)` once per intent in a settled cycle, `FeeCharged(recipient, token, amount)`, `NoncesInvalidated(maker, word, mask)`, plus the `FeeAdmin` events.
- Views: `MAX_CYCLE`, `MAX_ASSETS_PER_SIDE`, `FEE_TOKEN`, `hashIntent(intent)` (the EIP-712 struct hash), `intentDigest(intent)` (what the maker signs), `DOMAIN_SEPARATOR()`, `isNonceUsed(maker, nonce)`, plus the `FeeAdmin` views.

### Gas (worst case: 4 makers × 10 NFTs each way)

`settle` costs **3.34M gas** without the fee and **3.41M** with it (four more token transfers and a read of the fee; `test_worstCaseRingGas`), which is why `MAX_CYCLE` stays at 4. A plain NFT-for-ERC-20 swap is about 0.24M (about 0.3M with the fee), a three-way ring about 0.5M.

## FeeAdmin

[`FeeAdmin.sol`](../contracts/src/FeeAdmin.sol) is an abstract contract that `DeClubEscrow` and `DeClubIntents` both inherit ([ADR 0018](adr/0018-adjustable-protocol-fee.md)). The fee amount is the only thing about either deployed contract that can change. Constants: `MAX_FEE_LIMIT = 500 ether` and `FEE_RAISE_DELAY = 7 days`. Immutable: `MAX_FEE` and `FEE_RECIPIENT`. The fee, a queued raise and its time share one slot.

| Function | Caller | What it does |
|---|---|---|
| `constructor(initialFee, maxFee, feeRecipient, admin)` | deployer | Reverts with `FeeTooHigh(maxFee, MAX_FEE_LIMIT)`, `FeeTooHigh(initialFee, maxFee)` or `NoFeeRecipient` (a non-zero ceiling with no recipient). Emits `FeeAdminTransferred(0, admin)` when `admin` isn't zero. A zero admin fixes the fee for good. |
| `setFee(newFee)` | admin | Above `MAX_FEE`: `FeeTooHigh`. At or below the current fee: applies at once (`FeeChanged`) and drops any queued raise, so `setFee(fee())` cancels one. Above it: queues the raise for 7 days from now (`FeeChangeQueued(newFee, effectiveAt)`), replacing any queued raise and restarting the clock. |
| `applyFee()` | admin | Makes the queued raise the fee in force (`FeeChanged`). `NoPendingFee` if none, `FeeRaiseNotReady(effectiveAt)` before its time, `FeeRaiseExpired(effectiveAt)` more than `FEE_APPLY_WINDOW` (7 days) after it. A raise never applies by itself. |
| `transferFeeAdmin(next)` | admin | First step of a handover (`FeeAdminTransferStarted(current, next)`). A zero `next` cancels one. |
| `acceptFeeAdmin()` | pending admin | Takes the role (`FeeAdminTransferred(previous, next)`). Anyone else: `NotPendingFeeAdmin(caller)`. |
| `renounceFeeAdmin()` | admin | Clears the admin, any pending admin and any queued raise, and emits `FeeAdminTransferred(admin, 0)`. The fee never changes again. |

Every admin-only call reverts with `NotFeeAdmin(caller)` for anyone else. Views: `fee`, `pendingFee`, `pendingFeeAt`, `feeAdmin`, `pendingFeeAdmin`, `MAX_FEE`, `MAX_FEE_LIMIT`, `FEE_RAISE_DELAY`, `FEE_RECIPIENT`.

The contract accepts any ceiling up to 500 MON (or 500 WMON for intents). The deploy scripts require `PROTOCOL_FEE_MAX_WEI` whenever there is a fee, and a `FEE_ADMIN` whenever the ceiling isn't 0 unless `FEE_FIXED=true` (see [script/README.md](../contracts/script/README.md)); neither is a contract rule.

## DeClubRewards (Club rewards)

Reasoning: [ADR 0022](adr/0022-club-rewards.md). A Merkle distributor in MON, one root per epoch. It knows nothing about Clubs, deals or fees: the web server works out each epoch's payouts ([09 · Clubs](09-clubs.md#rewards)) and the operator publishes them. It holds no tokens, only MON.

```solidity
struct Epoch { bytes32 root; uint128 total; uint128 claimed; uint64 openAt; bool closed; }
struct Claim { uint64 epoch; address account; uint256 amount; bytes32[] proof; }
// leaf = keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(this), epoch, account, amount))))
```

| Function | What it does |
|---|---|
| `publish(epoch, root) payable` | Operator. Records the root with `total = msg.value` and `openAt = now + CLAIM_DELAY`. Once per epoch number; epochs can come in any order. |
| `revoke(epoch)` | Operator, before `openAt` (so nothing is claimed yet). Deletes the epoch and refunds `total` to the operator; the number can be published again. |
| `claim(epoch, account, amount, proof)` | Anyone. Pays `amount` to `account` if the proof shows that leaf, once, while the epoch is open and not swept. Never more than the epoch's own `total` in all. |
| `claimMany(claims)` | `claim` for several leaves, all or nothing. |
| `sweep(epoch)` | Operator, from `openAt + CLAIM_WINDOW`. Sends what's unclaimed to the operator and closes the epoch for good. |
| `transferOperator(next)` / `acceptOperator()` | Two-step handover, like `FeeAdmin`'s. A zero `next` cancels. |
| `epochs`, `isClaimed`, `leaf`, `operator`, `pendingOperator`, `CLAIM_DELAY`, `CLAIM_WINDOW`, `MAX_CLAIM_DELAY` (7 days), `MIN_CLAIM_WINDOW` (1 day), `MAX_CLAIM_WINDOW` (365 days) | Views. `CLAIM_DELAY` and `CLAIM_WINDOW` are fixed at deploy within those bounds. |

| Call | Reverts with |
|---|---|
| constructor | `NoOperator`, `BadTiming(delay, window)` |
| `publish` | `NotOperator`, `EpochExists`, `EmptyRoot`, `NothingFunded` |
| `revoke` | `NotOperator`, `UnknownEpoch`, `RevokeTooLate`, `PayoutFailed` |
| `claim`, `claimMany` | `ZeroAccount`, `UnknownEpoch`, `EpochClosed`, `NotOpenYet(epoch, openAt)`, `AlreadyClaimed`, `InvalidProof`, `OverClaim(epoch, claimed, total)`, `PayoutFailed(account)` |
| `sweep` | `NotOperator`, `UnknownEpoch`, `EpochClosed`, `SweepTooEarly(epoch, at)`, `PayoutFailed` |
| `acceptOperator` | `NotPendingOperator` |

Events: `EpochPublished(epoch, root, total, openAt)`, `EpochRevoked(epoch, refund)`, `RewardClaimed(epoch, account, amount)`, `EpochSwept(epoch, to, amount)`, `OperatorTransferStarted`, `OperatorTransferred`.

A payout that the account refuses reverts the claim (`PayoutFailed`): nothing else is at stake, and the leaf can be claimed again once the account accepts MON. Every entry point is `nonReentrant`, and state is written before the send.

## Phase 3: trait-based requests

Built in `DeClubEscrow` as `ERC721Trait` assets with `createTraitTrade` / `fillTraitTrade` ([ADR 0006](adr/0006-trait-requests-in-v2.md)). The first version, overloads on the deleted v1 escrow, used the same design.

Traits live in off-chain metadata, so the contract can't read them. The options considered:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Merkle set (chosen)** | The maker's app computes all token ids matching the traits and stores the root. The taker supplies `tokenId + proof`. | Trustless once the root is set, cheap to verify, needs no oracle | The root is fixed at creation. The maker's client must build the set correctly, and the UI shows the matched count so the maker can check it. |
| B. Signed attestation | A trusted signer signs `(tokenId, traitsHash)`. | Flexible | Adds a trusted party |
| C. On-chain trait registry | A trait table is written on-chain once. | Fully on-chain | Needs a large upfront write, and only the collection owner can do it credibly |

The leaf is `keccak256(abi.encode(collection, tokenId))` in a sorted-pair tree, built by `web/lib/merkle.ts`. The contract checks the count, rejects duplicate ids and verifies every proof before transferring anything. It proves only membership in the set; whether the set matches the traits it claims is checked by clients (the contract stores the maker's `spec` so they can rebuild it).

"Up to 3 MON" becomes the taker's choice of payment within a bound. Keep it simple: amounts on a locked deal are exact. Price negotiation stays off-chain, or goes through an open offer's proposals.

## Mocks

Testnet and tests only, in [`contracts/src/mocks/`](../contracts/src/mocks/).

### MockChog

[`MockChog.sol`](../contracts/src/mocks/MockChog.sol):

- `ERC721Enumerable("Mock Chog", "MCHOG")`
- `mint(address to, uint256 quantity) → firstId`: open mint, sequential ids from 1, at most `MAX_MINT_PER_TX = 20` per call
- `traitsOf(id) → (hat, eyes, background)`: deterministic from `keccak256(id, trait)`
  - Hat: None, Wizard Hat, Crown, Beanie, Cowboy Hat
  - Eyes: Blue, Green, Laser, Sleepy
  - Background: Purple, Mint, Sunset, Night
- `tokenURI`: fully on-chain base64 JSON with an SVG image and those traits as `attributes`, so the trait UI has real data to work with

### ChogGenesisMirror

[`ChogGenesisMirror.sol`](../contracts/src/mocks/ChogGenesisMirror.sol): a testnet copy of the real collection's identity.

- `ERC721Enumerable("Chog Genesis", "CHOG")`, `Ownable`
- `MAX_SUPPLY = 1969`
- `mintBatch(to, quantity) → firstId`: owner only, sequential ids from 1; `InvalidQuantity` for 0, `MaxSupplyExceeded` past 1,969
- `tokenURI(id)`: `METADATA_BASE` (the real collection's IPFS folder) + `id` + `.json`. Traits come from that metadata, not from the contract.

### MockERC20

[`MockERC20.sol`](../contracts/src/mocks/MockERC20.sol): `ERC20(name, symbol)`, 18 decimals. `mint(to, amount)` is open to anyone, up to `MAX_MINT_PER_TX = 1_000_000 ether` per call (`InvalidAmount` for 0 or more). `DeployEscrow.s.sol` deploys it as "Mock USD" (mUSD).

### MockWMON

[`MockWMON.sol`](../contracts/src/mocks/MockWMON.sol): `ERC20("Wrapped MON", "WMON")`, the same shape as WETH9: `deposit()` (and a `receive()` that deposits) mints 1:1, `withdraw(amount)` burns and sends MON back (`WithdrawFailed` if the send fails). Testnet has no canonical WMON, so `DeployIntents.s.sol` can deploy this as the intents fee token.

## Deployment

Four scripts in [`contracts/script/`](../contracts/script/). Each `run()` parses the env into a `Config`, calls `deploy(Config)` and logs the result, so tests can call `deploy` directly (env vars are process-wide and Forge runs tests in parallel). `DeployChog` deploys mocks, so it requires `block.chainid` 10143 (Monad testnet) or 31337 (Anvil) and reverts with "testnet deployment only" anywhere else; the other three also run on Monad mainnet (143), with stricter rules there, and revert with "unsupported chain" on any other chain. Commands are in [`contracts/script/README.md`](../contracts/script/README.md).

### `DeployEscrow.s.sol`

1. Deploy `DeClubEscrow(fee, maxFee, feeRecipient, feeAdmin)` from `PROTOCOL_FEE_WEI` (default 0), `PROTOCOL_FEE_MAX_WEI` (required with a fee), `FEE_RECIPIENT` and `FEE_ADMIN` (required with a non-zero ceiling unless `FEE_FIXED=true`, which deploys a fee nobody can change).
2. With `DEPLOY_MOCK_ERC20=true`, deploy `MockERC20("Mock USD", "mUSD")` and mint `DEMO_MINT_AMOUNT` whole tokens (default 1000) to each address in `DEMO_WALLETS`.
3. Print `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS`, `NEXT_PUBLIC_DECLUB_ESCROW_DEPLOY_BLOCK`, the fee settings read back from the contract, and `NEXT_PUBLIC_MOCK_ERC20_ADDRESS` when the mock was deployed.

### `DeployIntents.s.sol`

1. With `DEPLOY_MOCK_WMON=true` and no `FEE_TOKEN`, deploy `MockWMON` and use it as the fee token.
2. Deploy `DeClubIntents(feeToken, fee, maxFee, feeRecipient, feeAdmin)` from `FEE_TOKEN`, `PROTOCOL_FEE_WEI`, `PROTOCOL_FEE_MAX_WEI`, `FEE_RECIPIENT` and `FEE_ADMIN`, with the same rules as above. A given `FEE_TOKEN` must first wrap and unwrap 1 wei in the script's local simulation, with 18 decimals, or the script stops before broadcasting.
3. Print `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS`, `NEXT_PUBLIC_DECLUB_INTENTS_DEPLOY_BLOCK`, `MOCK_WMON_ADDRESS` when the mock was deployed, and the fee settings read back from the contract.

### `DeployRewards.s.sol`

1. Deploy `DeClubRewards(operator, claimDelay, claimWindow)` from `REWARDS_OPERATOR` (required), `REWARDS_CLAIM_DELAY` (default 1 day, 0 for a demo) and `REWARDS_CLAIM_WINDOW` (default 90 days).
2. On mainnet, refuse an operator with no code (it must be a Safe) and a claim delay under a day.
3. Print `NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS`, `NEXT_PUBLIC_DECLUB_REWARDS_DEPLOY_BLOCK`, and the operator, delay and window read back from the contract.

### `DeployChog.s.sol` (testnet only)

1. With `DEPLOY_CHOG_MIRROR=true`, deploy `ChogGenesisMirror`, mint `DEMO_MINT_PER_WALLET` (default 5) to each address in `DEMO_WALLETS`, then mint the rest of the 1,969 to `MIRROR_CATALOG_OWNER` (default: the deployer) in batches of `MIRROR_MINT_BATCH` (default 20).
2. Otherwise deploy `MockChog` and mint `DEMO_MINT_PER_WALLET` (at most 20) to each address in `DEMO_WALLETS`.
3. Print `NEXT_PUBLIC_CHOG_ADDRESS`.

The printed deploy blocks are the simulation block, a lower bound; the exact block is in the broadcast receipts.

### Deployed vs source

The current DeClub contracts are not deployed to testnet yet. Deploy
`DeClubEscrow`, `DeClubIntents` and `DeClubRewards` with the instructions in
[`contracts/script/README.md`](../contracts/script/README.md) before using the
app against testnet.
