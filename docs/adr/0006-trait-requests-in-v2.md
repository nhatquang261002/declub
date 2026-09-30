# ADR 0006: Trait requests in ChogSwapV2 as a fourth asset type

**Status:** Deferred · 2026-09-30 · Phase 4. Designed and prototyped (18 contract tests, 100% coverage, frontend), then taken out again before any deploy so it can be revisited. Nothing in the repo implements it now. Open before it returns: where trait data for collections other than Chog comes from (metadata reads, or an indexer).

## Context

[ADR 0005](0005-generic-asset-model.md) left trait requests ("any Chog with a Crown hat") on v1, because they need a Merkle set per collection and proofs at fill time. Keeping them there means the flagship feature can't be combined with the rest of V2 (a Chog for MON plus a token, say), and v1's version has a flaw of its own: it stores one number, `requestedCount`, as both the size of the Merkle set and the number of ids the taker must hand over. A trade for "any 1 Crown Chog" is impossible; the taker has to supply every id in the set.

## Decision

Add a fourth `AssetType`, appended so the existing values keep their numbers:

```solidity
enum AssetType { Native, ERC20, ERC721, ERC721Trait }
```

An `ERC721Trait` asset fits the existing `Asset` struct, so `getTrade` and `TradeCreated` carry it with no new views or events:

| Field | Meaning |
|---|---|
| `token` | the NFT collection |
| `id` | the Merkle root of the allowed ids, as a `uint256` |
| `amount` | how many NFTs the taker hands over, `1..MAX_ASSETS_PER_SIDE` |

The set's size never goes on-chain, so "any 1 of 40 Crown Chogs" is expressible. Leaves are `keccak256(abi.encode(token, tokenId))` and the tree is a sorted-pair tree, the same as v1's leaves, so `web/lib/merkle.ts` builds both.

**Requested side only.** A trait set is something only a taker can pay: nothing in escrow could match it. Creation rejects it on the offered side (`InvalidAsset`), along with a zero root, a zero or oversized `amount`, and a token that isn't a contract. Two trait assets with the same collection and root are `DuplicateAsset`, like any other duplicate.

**A second fill function, not an overload.** `fillTraitTrade(tradeId, TraitFill[] fills)` takes one `TraitFill { tokenIds, proofs }` per trait asset, in the order they appear in `requested`. `fillTrade(tradeId)` reverts with `TraitFillRequired` on a trade that has a trait asset, so the two entry points can't be confused. `fillTraitTrade` with an empty `fills` fills a trade that has none. A separate name keeps the wagmi ABI and the tests free of overload ambiguity.

**Checks before effects.** `_fill` verifies every proof before the status changes or anything moves. It requires `fills.length` to equal the number of trait assets and each fill to have exactly `amount` ids and proofs (`InvalidTraitFill`), rejects an id repeated within a set (`InvalidTraitFill`), and rejects a bad proof (`InvalidTraitProof(tokenId)`). The transfers themselves are the same `transferFrom` from taker to maker as an exact NFT request, so a taker who doesn't own an id reverts the whole fill. Everything else (taker rule, expiry, native amount, `nonReentrant`) is unchanged, and offered assets can never be trait assets, so payout and claim code needs no new case.

## Trust model

Unchanged from v1: the contract trusts the root the maker set, and proves only that each id is in that set. It can't know what the set means. The maker's client builds the set from the collection's traits, and the taker's client rebuilds it and checks the root equals the trade's before offering to fill. The UI names a trait request only when the root matches a set it can rebuild.

## Consequences

- `ChogSwapV2` is immutable, so this needs a **new deployment**. The V2 from ADR 0005 stays where it is and keeps working with its own ABI, but the app's V2 ABI is now this one. Trades in the old deployment are orphaned once the app points at the new address.
- V2 asset order matters when filling: `fills[k]` answers the k-th trait asset.
- The frontend can only fill a trait request whose set it can rebuild: the Chog catalog by trait (`traitsOf`). Other collections need their own metadata pipeline (the roadmap item on real Chog traits).
- v1's trait trades still work as before. Nothing about them changes, and the `requestedCount` flaw stays there.
- Needs external review like the rest of V2. Verified so far: unit and fuzz tests, 100% coverage of `ChogSwapV2`.
