# ADR 0005: Generic asset model in a separate `OnDealV2`

**Status:** Accepted · 2026-09-29 · Phase 4, first item

## Context

Phase 4 needs any ERC-721, ERC-20s and native in one trade, in any mix. A model built on one collection's ids plus a single MON amount per side can't hold that. The contract has no admin and no proxy ([03](../03-contract-design.md#declubescrow-locked-deals)), so the model can't change in place.

## Decision

Ship a new contract, **`OnDealV2`**. The rest of this record is its design.

**Asset model.** A trade is two `Asset[]`, offered and requested:

```solidity
enum AssetType { Native, ERC20, ERC721 }
struct Asset { AssetType assetType; address token; uint256 id; uint256 amount; }
```

Native has `token = 0, id = 0`; ERC-20 has `id = 0`; ERC-721 has `amount = 1`. Up to 10 assets per side. Everything else stays: atomic fill ([ADR 0001](0001-atomic-fill.md)), the maker escrows and the taker never does, expiry is derived, no admin (a flat per-side protocol fee was added later: [ADR 0015](0015-protocol-fee.md)), `transferFrom` only, no `receive()`.

**Any token, no allowlist.** The contract works on a per-token basis and never trusts a token to be honest about anything but its own balances, so a bad token can only hurt trades that name it. What that took:

| Problem | Handling |
|---|---|
| Fee-on-transfer / rebasing token offered | The escrow measures its balance before and after each ERC-20 deposit and reverts with `UnsupportedToken` unless the amount is exact. |
| Token or NFT that lies about a transfer | The same check catches ERC-20s. NFTs are checked with `ownerOf` afterwards (`NftNotReceived`). |
| USDT-style tokens with no return value | OpenZeppelin `SafeERC20`. |
| A recipient or token that rejects a payout (MON receiver that reverts, USDC-style blocklist, NFT with transfer hooks) | **Credit-and-claim.** Payouts out of escrow never revert. If the transfer fails, the amount goes into `claimable[account][asset]` and the recipient calls `claim` later. |
| Same asset on both sides, or listed twice | Rejected at creation (`SameAssetBothSides`, `DuplicateAsset`). Such a trade could never fill, or would double-count. |
| Re-entry through token callbacks (ERC-777 style) | The existing `nonReentrant` on every mutating function. Covered by a hook-token test. |

The taker's assets are different: they move straight to the maker, and a failure there **reverts the whole fill** (atomicity). The maker chose which tokens to accept, so a maker who asks for a blocklisted or fee-charging token only hurts their own trade. A blocklisted maker can make their trade unfillable, but the taker loses nothing and the maker can still cancel.

**MON on both sides is allowed only as MON for something else.** The maker's MON arrives at creation and the taker's at fill, so there is no conflict, and MON for MON is rejected as `SameAssetBothSides` like any other identical pair.

## Out of scope for V2 (and why)

- **Trait requests (Merkle sets).** These are per-collection and need proofs at fill time. They can come back as a new `AssetType` in a later contract.
- **ERC-1155 / ERC-4626 / ERC-777 specifics.** ERC-777 works as a plain ERC-20. The rest need their own semantics.
- **Trade intents, ring swaps, reputation.** Separate Phase 4 items. Ring swaps would build on this asset model.

## Consequences

- Storage per trade grows: 3 slots per asset, up to 60 to create the largest trade. Measured worst case (10 NFTs each way): **2.2M gas to create, 0.9M to fill.** Fine on Monad; tight on chains with a 30M block limit only if MAX is raised a lot.
- The frontend needs the new ABI and a trade reader. No indexer is needed: `getTrade` returns the full terms as before ([ADR 0004](0004-read-deals-from-storage.md)).
- Any ERC-20 can be listed, including scam tokens. The UI must show the token address, symbol and decimals from the chain, never a name the maker typed.
- Needs its own external review before mainnet.
