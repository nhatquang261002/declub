# ADR 0007: Open offers ("make me an offer") with escrowed proposals

**Status:** Accepted · 2026-09-30 · Phase 4. Implemented in `ChogSwapV2` (contract, unit and invariant tests; 100% coverage of the contract). Frontend built ([05](../05-frontend.md#chogswapv2-in-the-frontend-phase-4)). Not deployed yet.

## Context

Every V2 trade ([ADR 0005](0005-generic-asset-model.md)) fixes both sides up front: the maker says exactly what they want. A maker who isn't sure what they want ("what would you give me for this Chog?") has no way to say so. They'd have to guess a price and cancel and repost until it sticks.

An open offer flips the flow. The maker escrows what they give and leaves the ask empty. Takers respond with **proposals**, each an escrowed `Asset[]`, and the maker accepts one.

## Decision

**Escrowed proposals, on-chain.** A proposer locks their assets in the contract when they propose, the same way the maker does at creation. Accepting is then atomic and can't fail because a proposer moved their assets. The alternative, signed off-chain proposals, is cheaper for proposers but needs a service to hold them, which points at the indexer ([ADR 0003](0003-no-indexer-in-v1.md)). It can come later beside this, as a second way to submit a proposal.

### Creating an open offer

A new function, not a relaxed `createTrade`:

```solidity
function createOpenOffer(Asset[] calldata offered, address taker, uint64 expiry, string calldata note)
    external payable returns (uint256 tradeId);
```

`createTrade` keeps rejecting an empty requested side (`EmptySide`), so a client bug can't create an open offer by accident. An open offer is stored as a normal `Trade` with `requested.length == 0`, so `getTrade`, `TradeCreated` (with an empty `requested`) and the existing readers keep working. `taker`, if set, restricts who can propose.

**`note`.** Free text where the maker says what they're after ("any Chog with a crown, or 500 mUSD"). Rules:

- At most `MAX_NOTE_BYTES = 280` bytes, else `NoteTooLong`. Empty is allowed.
- Kept in its own `mapping(tradeId => string)` behind `offerNote(tradeId)`, not in the `Trade` struct, so the struct and its ABI stay as they are. Stored rather than only emitted, because the app reads state, not logs (ADR 0004). An `OfferNote(tradeId, note)` event is emitted too.
- Not binding. The contract never reads it, and the maker may accept any proposal regardless of the note. It's a hint to proposers.
- Only on open offers. Fixed trades have no note.

### Proposals

```solidity
enum ProposalStatus { None, Active, Accepted, Withdrawn, Rejected }
struct Proposal { address proposer; ProposalStatus status; Asset[] assets; }

function propose(uint256 tradeId, Asset[] calldata assets) external payable returns (uint256 proposalId);
function withdrawProposal(uint256 tradeId, uint256 proposalId) external;
function rejectProposal(uint256 tradeId, uint256 proposalId) external;   // maker
function acceptProposal(uint256 tradeId, uint256 proposalId) external;   // maker
```

Proposals live in `mapping(tradeId => Proposal[])`; ids are indexes and only ever append. Views: `proposalCount(tradeId)`, `getProposal(tradeId, id)`, and a paginated `getProposals(tradeId, offset, limit)`. No on-chain code loops over proposals, so there is no cap for correctness.

| Call | Who | Requires | Effect |
|---|---|---|---|
| `propose` | not the maker; the `taker` if one is set | trade `Open`, not expired, is an open offer, `msg.value` = the native amount | validates like a side of a trade, escrows the assets, adds an `Active` proposal |
| `withdrawProposal` | the proposer | proposal `Active`, at any time (trade open, filled, cancelled or expired) | status `Withdrawn`, assets go back |
| `rejectProposal` | the maker | trade `Open`, proposal `Active` | status `Rejected`, assets go back to the proposer |
| `acceptProposal` | the maker | trade `Open`, not expired, proposal `Active` | trade `Filled`, proposal `Accepted`; maker's offer goes to the proposer, the proposal's assets to the maker |

Everything else follows V2: every function is `nonReentrant`, checks → effects → interactions, and asset checks reuse `_validateSide`, `_deposit` and `_payout`. The overlap rule carries over: a proposal can't contain an asset the maker offers (`SameAssetBothSides`).

**Payouts out of escrow never revert.** Once a proposal is escrowed, paying it to the maker goes through the same credit-and-claim path as any escrow payout, so a maker who is blocklisted for a token can't be griefed by, and can't grief, the proposer's return path. This differs from `fillTrade`, where the taker's assets move straight to the maker and a failure reverts the fill.

**Accept emits `TradeFilled(tradeId, maker, proposer)`** plus `ProposalAccepted(tradeId, proposalId)`, so anything that watches `TradeFilled` still works. Other proposals are **not** touched: their proposers pull their assets back with `withdrawProposal`. No loop, no way for one proposal to block accepting another.

**A proposal is immutable.** Its assets can't change after `propose`, so the maker gets exactly what they saw when they accept, and there's no read-then-act gap. The only race is a proposer withdrawing in the same block, which makes `acceptProposal` revert (`ProposalNotActive`) with nothing lost.

### `fillTrade` on an open offer must revert

Today `fillTrade` on a trade with an empty requested side would pay out the maker's escrow to any caller for nothing. It gets an explicit guard, `OpenOfferNoFill(tradeId)`. This is the most important line of the change and has its own invariant (V8: an open offer can only leave `Open` through `acceptProposal`, `cancelTrade` or `reclaimExpired`).

### Cancel and expiry

`cancelTrade` and `reclaimExpired` work as before and return only the maker's offered assets. Proposals are untouched and stay withdrawable, so a maker can't strand a proposer's assets by cancelling. A proposer never depends on the maker to get assets back.

## Trust model

- The note is text from the maker, not a promise. The frontend renders it as plain text (never HTML, never auto-linked), truncates it in lists, and shows a fixed warning near it ("Not verified. Check the assets, not the note"). Token names and symbols still come from the chain, never from the note ([ADR 0005](0005-generic-asset-model.md)).
- The maker can't be forced to accept and can't be tricked into a different proposal than the one they picked.
- A proposer risks nothing but time: their assets are withdrawable until the moment of acceptance, and accepting is the maker's deliberate act.

## Known limitations

- **Proposal spam.** Anyone can add proposals, each costing them gas and a temporary escrow. It can't block correctness, but a busy offer can get noisy. Mitigations, none on-chain: a direct `taker` on the offer, and frontend sorting and hiding (dust, rejected, withdrawn). A cap or minimum can be added later if it becomes a real problem.
- **Locked capital.** A proposer's assets sit in escrow while the offer is open. They can leave whenever they like, so this is a cost, not a risk.
- **No counter-offers.** A rejected proposer can propose again, and there's no negotiation state beyond that.
- **No trait requests in a proposal.** A proposal is exact assets. Pairing this with [ADR 0006](0006-trait-requests-in-v2.md) is a separate step.

## Consequences

- `ChogSwapV2` is immutable, so this needs a **new deployment**, like ADR 0006 planned. It can carry both changes at once. The deployed V2 keeps working with its own ABI.
- The frontend gets a "Make me an offer" mode on `/v2/create` (note field with a byte counter, no requested editor), a Propose action on the detail page that reuses the asset editor, and a proposals list for the maker with Accept and Reject. The notification bell can fire on "new proposal on your trade" and "your proposal was accepted".
- Every open offer with proposals needs one read per proposal (`getProposal`), so the maker's detail page paginates.
- The invariant suite grows: contract balances cover every active trade, every `Active` proposal and every credit; `Accepted` proposals pay out exactly once; V8 above.
- Needs external review with the rest of V2.

## Open questions

- ~~Keep the name `ChogSwapV2` for the redeploy, or call the contract `V3`?~~ Decided: keep `ChogSwapV2`. The source changes in place, and the address on testnet changes when it's redeployed.
- Should a fixed-price trade also accept proposals (a "buy now or make an offer" listing)? This design says no: proposals exist only on open offers.
- Should a proposal carry a short note of its own?
