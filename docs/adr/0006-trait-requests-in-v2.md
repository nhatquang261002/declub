# ADR 0006: Trait requests in ChogSwapV2 as a fourth asset type

**Status:** Accepted, implemented, deployed (`ChogSwapV2` `0x7359…E1bB`, block 67163690) · 2026-09-30 · Phase 4. Contract, tests (31, 100% coverage of `ChogSwapV2`) and frontend are in the repo. It shipped in the same redeploy as ADR 0007's open offers. An earlier draft of this ADR was prototyped and taken out; this version adds the on-chain spec, several traits per request, and a scan that works for any collection.

## Context

[ADR 0005](0005-generic-asset-model.md) left trait requests ("any Chog with a Crown hat") on v1, because they need a Merkle set per collection and proofs at fill time. Keeping them there means the flagship feature can't be combined with the rest of V2 (a Chog for MON plus a token, say), and v1's version has a flaw of its own: it stores one number, `requestedCount`, as both the size of the Merkle set and the number of ids the taker must hand over. A trade for "any 1 Crown Chog" is impossible; the taker has to supply every id in the set.

Two more needs came up:

- A request should be able to combine **several traits** (Crown, Gold eyes, ...), as "any of them" or "all of them".
- The traits should come from **whichever collection** the maker names, not just Chog.

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

The set's size never goes on-chain, so "any 1 of 40 Crown Chogs" is expressible. Leaves are `keccak256(abi.encode(token, tokenId))` and the tree is a sorted-pair tree, the same as v1's leaves, so `web/lib/merkle.ts` builds both. A test pins a root and proof produced by the TypeScript builder to the contract's OpenZeppelin verifier.

**Requested side only.** A trait set is something only a taker can pay: nothing in escrow could match it. Creation rejects it on the offered side and in proposals (`InvalidAsset`), along with a zero root, a zero or oversized `amount`, and a token that isn't a contract. Two trait assets with the same collection and root are `DuplicateAsset`, like any other duplicate.

### Several traits, any or all: no contract support needed

The contract only sees a root, and a root can commit to any set of ids. "Crown **or** Halo" and "Crown **and** Gold eyes" are just two different sets, computed by the maker's client from the collection's traits. So the picker offers 2–5 traits and an "any one of them" / "all of them" switch, and the contract is unchanged by either. For different NFTs each with their own trait ("a Crown and a Gold-eyed one") a request lists several trait assets, each with `amount` 1.

### The description is published on-chain

A root alone can't be named: with combinations, the space of possible roots is too large to enumerate, so a taker's client couldn't tell what it means. So trait deals are created with `createTraitTrade(offered, requested, taker, expiry, spec)`:

- `spec` is text of 1 to `MAX_SPEC_BYTES` (1024) bytes, stored (`traitSpec(id)`) and emitted (`TraitSpec`). It's stored, not only emitted, because the public RPC caps `eth_getLogs` at 100 blocks (ADR 0004).
- It's **opaque to the contract**, like an open offer's note. The app writes compact JSON: one clause per trait asset in `requested`, in order, as `{"v":1,"c":[{"t":"0x…","m":"any"|"all","p":[["Hat","Crown"],...],"n":1}]}`.
- `createTraitTrade` requires at least one trait asset (`NoTraitAsset`), and `createTrade` rejects trait assets, so a trait deal can't exist without a spec (`BadTraitSpec`).

### Filling: a second function, not an overload

`fillTraitTrade(tradeId, TraitFill[] fills)` takes one `TraitFill { tokenIds, proofs }` per trait asset, in the order they appear in `requested`. `fillTrade(tradeId)` reverts with `TraitFillRequired` on a trade that has a trait asset. `fillTraitTrade` with an empty `fills` fills a trade that has none. A separate name keeps the wagmi ABI and the tests free of overload ambiguity.

`_fill` verifies every proof before the status changes or anything moves. It requires `fills.length` to equal the number of trait assets and each fill to have exactly `amount` ids and proofs (`InvalidTraitFill`), rejects an id repeated within a set (`InvalidTraitFill`), and rejects a bad proof (`InvalidTraitProof(fillIndex, tokenId)`). The transfers are the same `transferFrom` from taker to maker as an exact NFT request, so a taker who doesn't own an id reverts the whole fill. Everything else (taker rule, expiry, native amount, `nonReentrant`) is unchanged, and offered assets can never be trait assets, so payout and claim code needs no new case.

### Traits come from a scan of the named collection

When the maker enters a collection, the app asks `GET /api/collection-traits?address=…` (`lib/server/collectionScan.ts`). The server reads `totalSupply` (and `tokenByIndex` if the collection is `ERC721Enumerable`, else ids `0..n-1` or `1..n`, checked at both ends), then each `tokenURI` and its JSON `attributes`, and keeps the result in memory. The picker (and the "By trait" deal type) only works if this succeeds. If it can't, the maker is told why and can still request exact NFTs.

A collection is refused if it isn't an ERC-721, has no `totalSupply`, has non-sequential ids and no enumeration, returns no metadata, or has more than 10,000 tokens (a partial set would silently leave tokens out). Tokens whose metadata can't be read are left out of every set, and the UI says how many. The server fetches only public `https` hosts (and `ipfs://` through a gateway), with a timeout, a size cap and no redirects, since any collection can point `tokenURI` anywhere.

## Trust model

Unchanged from v1: the contract trusts the root the maker set, and proves only that each id is in that set. It can't know what the set means, or whether the spec is honest.

Before a taker's client offers a fill, it rebuilds each set from the spec and the collection's traits and checks the root equals the deal's. If it doesn't (a lying maker, a stale spec, changed metadata, a scan the taker's server can't do), the deal is shown with a warning and can't be accepted from the app. A deal whose spec is missing or unreadable is treated the same way. Nothing is lost either way: the maker can still cancel, and the contract still enforces the set.

## Consequences

- `ChogSwapV2` is immutable, so this needs a **new deployment**. The V2 from ADR 0005 stays where it is and keeps working with its own ABI, but the app's V2 ABI is now this one. Trades in the old deployment are orphaned once the app points at the new address. It can share the redeploy with ADR 0007.
- V2 asset order matters when filling: `fills[k]` answers the k-th trait asset, and the k-th clause of the spec.
- The maker's set is fixed at creation. NFTs whose traits change afterwards stay in or out of it; a mutable collection can make the rebuilt root differ, which blocks filling from the app.
- The scan is a server feature, so it needs the Next.js server (not a static export), reads the RPC hard on first use of a collection, and refuses collections above 10,000 tokens. An indexer could replace it later without touching the contract.
- The list of deals shows a trait request as "By trait, any N" and the collection. The traits themselves load on the deal page, which reads the spec.
- v1's trait trades still work as before. Nothing about them changes, and the `requestedCount` flaw stays there.
- Needs external review like the rest of V2. Verified so far: unit and fuzz tests, 100% coverage of `ChogSwapV2`, and the scan against the deployed MockChog. Not yet exercised: a deployed V2 with the new ABI, and the create and fill screens against it.
