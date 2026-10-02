# ADR 0008: Signed trade intents and an off-chain matcher

**Status:** Accepted · 2026-10-01 · Phase 4. Open questions settled below. `OnDealIntents` is implemented and tested (65 tests, 100% coverage) and deployed to Monad testnet (see the README). The pool and local matcher are built and tested in [`matcher/`](../../matcher/README.md); the frontend screens are built in [`web/`](../05-frontend.md#intents-in-the-frontend-phase-4). [ADR 0009](0009-ring-swaps.md) builds on this one and shares its contract.

## Context

Every V2 trade ([ADR 0005](0005-generic-asset-model.md), [0007](0007-open-offers.md)) starts with an on-chain transaction that **escrows** the maker's assets. That is safe, but it has costs a trader feels:

- Posting costs gas, and so does changing your mind (cancel, repost).
- The assets are locked while you wait. A holder with ten Chogs can't say "I'd swap any of these" across ten listings without escrowing all ten, or picking one.
- Nobody finds you a counterparty. The book is a list to browse; matching is manual.

An **intent** is a signed statement of what you'll give and what you want back, with nothing escrowed. Posting one is free and instant. A **matcher** (an off-chain service, but anyone can run one) finds intents that fit together and submits them to a contract that settles them atomically, wallet to wallet.

Intents are a third path beside fixed trades and open offers, not a replacement. V2 keeps its guarantee (escrowed, can't fail at settlement). Intents trade that guarantee for zero cost to post and no lockup.

## Decision

A new contract, **`OnDealIntents`**, separate from `OnDealV2` (which is immutable and live), plus an off-chain intent pool and matcher.

### The intent

An EIP-712 typed message signed by the maker:

```solidity
struct Intent {
    address maker;
    Asset[] give;      // exact; what the maker pays
    Asset[] want;      // what the maker must receive at least
    uint64  deadline;  // required, non-zero
    uint256 nonce;     // unordered, see below
}
```

`Asset` is V2's struct ([ADR 0005](0005-generic-asset-model.md)) with its field rules, restricted to `ERC20` and `ERC721`. Up to `MAX_ASSETS_PER_SIDE = 10` per side, no duplicates, and no asset on both sides of the same intent.

- **`give` is exact and all-or-nothing.** Whatever settles, the maker pays exactly `give`. There are no partial fills in this version.
- **`give` is paid in full to the next maker**, including assets the receiver didn't ask for.
- **`want` is a floor.** For ERC-20, `amount` is a minimum. For ERC-721, the exact token. The maker gets `give` from the counterparty that is at least `want`; any surplus goes to the maker (the receiver), so a limit price works as one expects: "I'll pay 100 mUSD, I'll take at least 90".
- **Native MON is not allowed.** It can't be pulled from a wallet by a contract, so it can't be part of an intent. Use WMON. This is the biggest difference from V2 and the UI must say so.
- **No ERC-721 traits yet.** A trait want needs proofs supplied at settlement. See open questions.

The EIP-712 domain is `{name: "OnDealIntents", version: "1", chainId, verifyingContract}`. The type hash covers every field, with the `Asset[]` arrays hashed per the EIP, so a signature can't be replayed on another chain or contract or with edited terms.

### Settlement

```solidity
function settle(Intent[] calldata cycle, bytes[] calldata signatures) external;
```

Callable by anyone. `cycle` is an ordered list of `n` intents, where `cycle[i].give` is paid to `cycle[(i+1) % n].maker`. For `n = 2` this is a plain two-party swap. Larger `n` and the cycle rules belong to [ADR 0009](0009-ring-swaps.md); `MAX_CYCLE` is set there.

For each intent the contract checks:

| Check | Revert |
|---|---|
| `block.timestamp <= deadline` | `IntentExpired` |
| the signature is valid for `maker` (EOA via ECDSA, contract wallets via ERC-1271) | `BadSignature` |
| the nonce is unused | `NonceUsed` |
| `cycle[i-1].give` covers `want` for every asset, by type, token and id, with amounts at least `want.amount` | `WantNotMet` |
| the maker is not the previous or next party in the cycle, and no maker appears twice | `DuplicateMaker` |

Then, checks first and effects second: **every nonce is marked used before any asset moves**, and the function is `nonReentrant`. Interactions come last:

- ERC-20: `safeTransferFrom(maker, recipient, amount)`, and the **recipient's balance is measured before and after**. Any difference from `amount` reverts (`UnsupportedToken`), the same rule V2 applies to escrow deposits.
- ERC-721: `transferFrom(maker, recipient, id)`, then `ownerOf(id) == recipient` or `NftNotReceived`.

**Any failure reverts the whole settlement.** There is no credit-and-claim path here because the contract never holds anything: V2 needed it because a payout out of escrow must not be blockable by the recipient, but here the transfer is wallet to wallet and an atomic revert leaves everyone exactly where they started.

The contract has no `receive()`, no `fallback`, no admin and no upgrade path, and it is never the owner or holder of any asset after a call. It does charge a flat protocol fee, but only by moving WMON from each maker straight to the fee recipient inside `settle`, so it still holds nothing ([ADR 0015](0015-protocol-fee.md)).

### Cancellation and replay

Nonces are **unordered**, in the Permit2 style: a `mapping(address => mapping(uint256 word => uint256 bitmap))`, with the nonce's high bits picking the word and its low 8 bits picking the bit. A maker can have any number of intents live at once and cancel any of them independently:

```solidity
function invalidateNonces(uint256 word, uint256 mask) external;
```

This costs gas and is needed only when a maker wants to be certain an intent can never settle. The common, free path is: tell the pool to drop it, and rely on a short `deadline`. A signature that has already left the pool can still be used until it expires or its nonce is invalidated, so a short deadline is the real protection and the UI should default to one (hours, not weeks).

### The off-chain pool and matcher

This is the first backend in the project, and the first time [ADR 0003](0003-no-indexer-in-v1.md)'s "when to revisit" conditions are met by design rather than by accident.

- **Pool.** A small HTTP service: `POST /intents` (verify the signature, then store), `GET /intents` (the book, filterable by asset), `DELETE /intents/:hash` (maker-signed, or by owner token). Sqlite or Postgres. It reads the chain only to check that an intent is still plausible (balance, approval, ownership, nonce, deadline) and prunes the ones that aren't.
- **Matcher.** Reads the pool, finds a set of intents that satisfy each other, **simulates `settle` with `eth_call`**, and only then sends it. The two-party case indexes intents by the asset keys they give and want and joins the two sides; cycles longer than two are in ADR 0009.
- **It is not authoritative and not trusted.** An intent is a self-contained signature, so it's portable: anyone can run their own pool or matcher, and the same intent can sit in several. The matcher can censor (never match you) or pick between valid counterparties, but it **can't change terms, move assets you didn't sign for, or take anything**: the contract enforces your `give` and `want`, not the matcher.
- **Who pays for settlement gas?** The caller of `settle`, which is the matcher. In v1 that is us, as a subsidy while volume is small. A signed tip is an open question below.

### Approvals

Because nothing is escrowed, the maker has to leave an **approval standing** on `OnDealIntents` until the intent settles, expires or is invalidated. That is a real change from V2, where approvals are used immediately at create:

- The contract can move a maker's approved assets only under an unexpired, unused signature from that maker. It can't be tricked into anything else: no arbitrary calls, no delegatecall, no admin.
- The UI should prefer the narrowest approval that works: `approve(id)` for a single NFT over `setApprovalForAll`, and an exact `approve(amount)` for ERC-20s. It must say plainly that signing and approving together let the intent execute without further confirmation.
- ERC-2612 permits would save an approval transaction for tokens that support them. Later.

## Trust model

- **A maker can break an intent after signing it**: spend the tokens, move the NFT, or revoke the approval. Then `settle` reverts and the matcher has paid gas for nothing. No other party loses funds. This is the price of free posting and is why the matcher must simulate right before sending and may rate-limit or ignore makers whose intents repeatedly fail.
- **A counterparty is whoever fits.** Signing an intent consents to any counterparty that meets `want`. Addresses can't be restricted in this version.
- **Signed intents are bearer instruments for their terms.** Whoever holds one can submit it, but only to a settlement that pays the maker at least `want` and takes exactly `give`.

## Known limitations

- **Settlement can fail.** Unlike V2 it isn't guaranteed. The fix is for the matcher to simulate, and for makers to keep assets and approvals in place.
- **No partial fills, no native MON, no traits, no counterparty restriction.** Each is a deliberate cut to keep the first version small and checkable.
- **The pool is centralised in v1.** If ours is down, no new matches happen, but nothing already on-chain is affected, and anyone can run another.
- **Surplus goes to the receiver.** The maker who asks less than the counterparty gives gets the difference. Makers who want a fixed price should set `want` equal to the counterparty's `give`.

## Consequences

- One new contract and one new service. The service is the first moving part that needs hosting, monitoring and a `.env` entry for its RPC.
- New contract tests: unit per revert, fuzz over random asset sets, and invariants:
  - **N1:** after any call, the contract holds no native, no ERC-20 and no ERC-721.
  - **N2:** a nonce settles at most once, and never after it is invalidated.
  - **N3:** every asset leaves the wallet of an address whose valid signed intent covers it.
  - **N4:** every maker receives at least `want` and pays exactly `give`.
  - **N5:** nothing settles after its deadline.
- Frontend: a "Post intent" screen (asset editors reused, EIP-712 signing, short-deadline default, approval step), a "My intents" list with status and cancel, and a notification when one settles. Intents never appear in `useTradesV2` and need their own reader against the pool.
- External review before mainnet, as for V1 and V2. Standing approvals make this contract more sensitive than V2, so it gets the closest look.

## Decisions on the open questions (2026-10-01)

- **Trait wants:** not in v1. Exact token ids only; traits can come in a later contract.
- **Matcher tip:** none. We subsidise settlement gas while volume is small; revisit if others want to run matchers.
- **Counterparty restriction:** none. Signing consents to any counterparty that meets `want`, and the UI says so.
- **Pool host:** a local Node/viem script run with a funded testnet key (no hosted service) for the hackathon demo. The pool is a small local service beside it.
- **Partial fills:** none. `give` is all-or-nothing.
