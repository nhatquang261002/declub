# 03 · Contract Design

Interface (source of truth): [`contracts/src/interfaces/IChogSwap.sol`](../contracts/src/interfaces/IChogSwap.sol)
Implementation: [`contracts/src/ChogSwap.sol`](../contracts/src/ChogSwap.sol)

## Scope of v1

- One ERC-721 collection, fixed at deploy (`chog`, immutable).
- Native MON on either side of a trade, but not both.
- Exact token ids only. Trait matching is Phase 3 (see [below](#phase-3-trait-based-requests)).
- No fees, no admin, no pausing, no upgradeability.

## State machine

```text
                 createTrade
                     │   (maker's Chogs + MON pulled into escrow)
                     ▼
                ┌─────────┐
                │  OPEN   │──── block.timestamp > expiry ───► "expired" (derived, still OPEN)
                └────┬────┘                                        │
        fillTrade    │    cancelTrade (maker)                      │ reclaimExpired (anyone)
       ┌─────────────┴──────────────┐                              │ cancelTrade (maker)
       ▼                            ▼                              ▼
  ┌─────────┐                 ┌───────────┐ ◄────────────────────────┘
  │ FILLED  │                 │ CANCELLED │
  └─────────┘                 └───────────┘
  escrow → taker              escrow → maker
  taker side → maker
```

- `Status { None, Open, Filled, Cancelled }`. `None` is what an unknown id reads as.
- **Expired is derived, not stored.** `isExpired(id) = expiry != 0 && block.timestamp > expiry`. No transaction is needed to "expire" a trade.
- Both terminal states are final. Every mutating function requires `status == Open`.
- The spec's `ACCEPTED / DEPOSITING / READY` states are dropped because the fill is atomic ([ADR 0001](adr/0001-atomic-fill.md)).

## Storage

```solidity
address public immutable chog;                    // cast to IERC721 at call sites
uint256 public constant MAX_TOKENS_PER_SIDE = 10;

uint256 public tradeCount;                        // last id issued; ids start at 1
mapping(uint256 => Trade) internal _trades;
mapping(address => uint256) public pendingWithdrawal;
```

`Trade` fields (see the interface for NatSpec): `maker, expiry(uint64), status, taker, offeredMon, requestedMon, offeredIds[], requestedIds[]`.
Slot packing: `maker + expiry + status` fit in one slot.

## Functions

Every mutating function is `nonReentrant` and follows checks → effects → interactions. Events are emitted in the effects step, before any external call.

### `createTrade(offeredIds, requestedIds, requestedMon, taker, expiry) payable → tradeId`

| Check | Error |
|---|---|
| `offeredIds.length == 0 && msg.value == 0` | `EmptySide` |
| `requestedIds.length == 0 && requestedMon == 0` | `EmptySide` |
| `msg.value > 0 && requestedMon > 0` | `MonOnBothSides` |
| either array longer than `MAX_TOKENS_PER_SIDE` | `TooManyTokens` |
| `expiry != 0 && expiry <= block.timestamp` | `ExpiryInPast` |

Effects: `tradeId = ++tradeCount`, store the trade with `offeredMon = msg.value` and `status = Open`.
Interactions: `chog.transferFrom(msg.sender, address(this), id)` for each offered id. The Chog contract reverts if the caller doesn't own an id or hasn't approved the contract. Duplicate ids revert naturally, because the second pull comes from an address that no longer owns the token.
Emit `TradeCreated`.

> Requested ids aren't checked against current owners at creation. Ownership can change before a fill, and the fill checks it anyway. The UI shows the current owner as a hint.

### `fillTrade(tradeId) payable`

| Check | Error |
|---|---|
| `status != Open` | `TradeNotOpen` |
| `isExpired` | `TradeIsExpired` |
| `taker != 0 && msg.sender != taker` | `NotAllowedTaker` |
| `msg.sender == maker` | `SelfFill` |
| `msg.value != requestedMon` | `WrongMonAmount(expected, sent)` |

Effects: `status = Filled`.
Interactions, in order:
1. `chog.transferFrom(msg.sender, maker, id)` for each requested id (the taker's side goes straight to the maker)
2. `chog.transferFrom(address(this), msg.sender, id)` for each offered id
3. `_sendMon(maker, requestedMon)`
4. `_sendMon(msg.sender, offeredMon)`

Emit `TradeFilled(tradeId, maker, msg.sender)`.

### `cancelTrade(tradeId)`

Checks: `status == Open` (`TradeNotOpen`) and `msg.sender == maker` (`NotMaker`). This works whether or not the trade has expired.
Effects: `status = Cancelled`. Interactions: `_refund(trade)`. Emit `TradeCancelled`.

### `reclaimExpired(tradeId)`

Checks: `status == Open` and `isExpired` (`TradeNotExpired`). Anyone can call it.
Effects: `status = Cancelled`. Interactions: `_refund(trade)`, which pays the **maker**, never the caller. Emit `TradeReclaimed(tradeId, maker, msg.sender)`.

### `withdraw()`

`amount = pendingWithdrawal[msg.sender]`. If it's zero, revert with `NothingToWithdraw`. Otherwise zero the balance and then `call{value: amount}`. If the call fails, revert with `WithdrawFailed` (the zeroing is rolled back with it). Emit `Withdrawn`.

### Internal helpers

```text
_refund(t):  for id in t.offeredIds: chog.transferFrom(this, t.maker, id)
             _sendMon(t.maker, t.offeredMon)

_sendMon(to, amt):
    if amt == 0: return
    (ok,) = to.call{value: amt}("")      // forwards all gas (nonReentrant guards us)
    if !ok: pendingWithdrawal[to] += amt; emit WithdrawalCredited(to, amt)
```

`_sendMon` never reverts. A recipient that rejects MON can't block a fill, cancel or reclaim; the MON is held for them to withdraw.

### Views

`chog()`, `MAX_TOKENS_PER_SIDE()`, `tradeCount()`, `getTrade(id)`, `isExpired(id)`, `pendingWithdrawal(addr)`.

## Transfer choices

- **`transferFrom` everywhere, never `safeTransferFrom`.** Recipients are always the trade's own parties, and every one of them was a transaction sender that already interacted with the Chog contract. Plain `transferFrom` also gives recipients no `onERC721Received` callback to re-enter through.
- **No `IERC721Receiver`, no `receive()` or `fallback()`.** Chogs sent with `safeTransferFrom` and plain MON transfers to the contract revert instead of getting stranded. The only way assets get in is through `createTrade`.
- The Chog is assumed to be a standard ERC-721 (OpenZeppelin-compatible `transferFrom` that reverts on failure). Check this before pointing the deployment at the real collection.

## Events

| Event | Emitted by | Indexed |
|---|---|---|
| `TradeCreated(id, maker, taker, offeredIds, offeredMon, requestedIds, requestedMon, expiry)` | `createTrade` | id, maker, taker |
| `TraitTradeCreated(id, maker, taker, offeredIds, offeredMon, requestedRoot, requestedCount, requestedMon, expiry)` | trait `createTrade` overload | id, maker, taker |
| `TradeFilled(id, maker, taker)` | `fillTrade` | all |
| `TradeCancelled(id, maker)` | `cancelTrade` | all |
| `TradeReclaimed(id, maker, caller)` | `reclaimExpired` | all |
| `WithdrawalCredited(account, amount)` | `_sendMon` on failure | account |
| `Withdrawn(account, amount)` | `withdraw` | account |

`TradeCreated` carries all the terms, so a client can rebuild every trade from logs alone and then call `getTrade` only to confirm the live status.

## Errors

`EmptySide`, `MonOnBothSides`, `TooManyTokens(count, max)`, `ExpiryInPast(expiry)`, `TradeNotOpen(id)`, `TradeIsExpired(id)`, `TradeNotExpired(id)`, `NotMaker(id)`, `NotAllowedTaker(id)`, `SelfFill(id)`, `WrongMonAmount(expected, sent)`, `InvalidTraitRequest`, `InvalidTraitProof(tokenId)`, `NothingToWithdraw`, `WithdrawFailed`.

Deploy-time only (declared on `ChogSwap`, not the interface): `InvalidCollection(chog)`, raised when the collection address has no code, which includes `address(0)`.

The frontend maps each error to a readable message ([05 · Frontend](05-frontend.md#error-messages)).

## Gas bounds

`MAX_TOKENS_PER_SIDE = 10` caps a fill at 20 NFT transfers plus 2 MON sends.

Measured with `forge test --gas-report`:

| Call | Typical | Worst case |
|---|---|---|
| `createTrade` | ~278k (1 ↔ 1) | ~1.07M (10 ↔ 10) |
| `fillTrade` | ~162k (1 ↔ 1) | ~835k (10 ↔ 10 + MON; test asserts < 1.5M) |
| `cancelTrade` | ~115k | ~177k |
| `reclaimExpired` | ~171k | ~198k |
| `withdraw` | ~42k | |
| Deploy | MockChog ~1.97M, ChogSwap ~1.14M (estimated against Monad testnet) | |

Most of `createTrade`'s cost is storing both id arrays. That's what lets `getTrade` return a trade's full terms after it closes.

## MockChog

[`contracts/src/mocks/MockChog.sol`](../contracts/src/mocks/MockChog.sol), testnet and tests only:

- `ERC721Enumerable("Mock Chog", "MCHOG")`
- `mint(address to, uint256 quantity) → firstId`: open mint, sequential ids from 1, at most 20 per call
- `traitsOf(id) → (hat, eyes, background)`: deterministic from `keccak256(id, trait)`
  - Hat: None, Wizard Hat, Crown, Beanie, Cowboy Hat
  - Eyes: Blue, Green, Laser, Sleepy
  - Background: Purple, Mint, Sunset, Night
- `tokenURI`: fully on-chain base64 JSON with an SVG image and those traits as `attributes`, so the Phase 3 trait UI has real data to work with

## Deployment

[`contracts/script/Deploy.s.sol`](../contracts/script/Deploy.s.sol):

1. If `CHOG_ADDRESS` is empty, deploy `MockChog` and mint `DEMO_MINT_PER_WALLET` Chogs to each address in `DEMO_WALLETS`.
2. Deploy `ChogSwap(chog)`.
3. Log both addresses and the deploy block as ready-to-paste `NEXT_PUBLIC_*` lines.

`run()` only parses the env into a `Config` and calls `deploy(Config)`, so tests can call `deploy` directly. Env vars are process-wide and Forge runs tests in parallel. Commands are in [`contracts/script/README.md`](../contracts/script/README.md).

---

## Phase 3: trait-based requests

Traits live in off-chain metadata, so the contract can't read them. Options:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Merkle set (recommended)** | The maker's app computes all token ids matching the traits and stores `requestedRoot`. The taker supplies `tokenId + proof`. | Trustless once the root is set, cheap to verify, needs no oracle | The root is fixed at creation. The maker's client must build the set correctly, and the UI shows the matched count so the maker can check it. |
| B. Signed attestation | A trusted signer signs `(tokenId, traitsHash)`. | Flexible | Adds a trusted party |
| C. On-chain trait registry | A trait table is written on-chain once. | Fully on-chain | Needs a large upfront write, and only the collection owner can do it credibly |

Implemented as a backward-compatible `createTrade` overload and `fillTrade` overload.
Trait terms are exposed by the `requestedRoot(tradeId)` and `requestedCount(tradeId)`
views (the legacy `Trade` tuple and exact-ID path are unchanged). Each leaf is
`keccak256(abi.encode(chog(), tokenId))`, making roots collection-scoped; callers
must provide one sorted-pair Merkle proof per requested token. The contract checks
the count, rejects duplicate ids, verifies every proof before transferring anything,
and enforces the same taker, expiry, MON, and ten-token bounds as exact-ID fills.

"Up to 3 MON" becomes the taker's choice of payment within a bound. Keep it simple: the maker's `offeredMon` is an exact amount. Price negotiation stays off-chain for now.

## Phase 4: generalized assets

```solidity
enum AssetType { ERC721, ERC20, NATIVE }
struct Asset { AssetType assetType; address token; uint256 tokenId; uint256 amount; }
```

Replace `offeredIds/offeredMon` with `Asset[] offered` and do the same for the requested side. Add a token allowlist (or accept any token and warn in the UI). ERC-20 transfers use `SafeERC20`, and fee-on-transfer tokens are rejected by checking balances before and after. Multi-party ring swaps become an `n`-leg trade where every leg's assets are escrowed and settlement runs once all legs are funded, with refunds after expiry.

## Phase 4: `ChogSwapV2` (generic assets)

Reasoning: [ADR 0005](adr/0005-generic-asset-model.md). Interface: [`IChogSwapV2.sol`](../contracts/src/interfaces/IChogSwapV2.sol). Implementation: [`ChogSwapV2.sol`](../contracts/src/ChogSwapV2.sol). It's a separate contract with no constructor arguments, so it works with any token and v1 is untouched.

```solidity
enum AssetType { Native, ERC20, ERC721, ERC721Trait }
struct Asset { AssetType assetType; address token; uint256 id; uint256 amount; }
struct Trade { address maker; uint64 expiry; Status status; address taker; Asset[] offered; Asset[] requested; }
```

### Functions

| Function | What it does |
|---|---|
| `createTrade(offered, requested, taker, expiry) payable` | Validates both sides, then pulls every offered asset into escrow. `msg.value` must equal the native amount in `offered` (or 0). |
| `fillTrade(id) payable` | `msg.value` must equal the native amount in `requested`. Requested assets go taker → maker (a failure reverts the fill); every offered asset goes escrow → taker. |
| `createTraitTrade(offered, requested, taker, expiry, spec) payable` | `createTrade` for a `requested` side with `ERC721Trait` assets (a Merkle root of allowed ids and a count). `spec` (1–1024 bytes) describes them for clients. [ADR 0006](adr/0006-trait-requests-in-v2.md). |
| `fillTraitTrade(id, fills) payable` | `fillTrade` for a trade with trait assets: `fills[k]` is `{tokenIds, proofs}` for the k-th trait asset. `fillTrade` reverts with `TraitFillRequired` on such a trade. |
| `cancelTrade(id)` | Maker, while open. Refunds the offered side to the maker. |
| `reclaimExpired(id)` | Anyone, once expired. Refunds to the maker. |
| `claim(assetType, token, id)` | Collect a payout that was rejected earlier. |
| `getTrade`, `isExpired`, `tradeCount`, `traitSpec(id)`, `claimable(account, assetType, token, id)`, `MAX_ASSETS_PER_SIDE`, `MAX_SPEC_BYTES` | Views. |

### Create-time checks

| Check | Error |
|---|---|
| a side is empty | `EmptySide` |
| more than 10 assets on a side | `TooManyAssets(count, max)` |
| field rules per type (see the ADR): native has no token/id, ERC-20 has a contract and no id, ERC-721 has a contract and amount 1, amounts > 0 | `InvalidAsset(index)` |
| same `(type, token, id)` twice on a side | `DuplicateAsset(index)` |
| same `(type, token, id)` on both sides | `SameAssetBothSides(i, j)` |
| trait asset on the offered side, in a proposal, or via `createTrade`; zero root, zero or > 10 `amount`, or non-contract token | `InvalidAsset(index)` |
| `createTraitTrade` without a trait asset / with an empty or oversized spec | `NoTraitAsset` / `BadTraitSpec(length, max)` |
| `msg.value` ≠ native amount offered | `WrongNativeAmount(expected, sent)` |
| `expiry` in the past | `ExpiryInPast` |
| ERC-20 deposit delivered a different amount | `UnsupportedToken(token)` |
| NFT not owned by the escrow after the transfer | `NftNotReceived(token, id)` |

The fill, cancel and reclaim checks are the same as v1's (`TradeNotOpen`, `TradeIsExpired`, `NotAllowedTaker`, `SelfFill`, `NotMaker`, `TradeNotExpired`), with `WrongNativeAmount` in place of `WrongMonAmount`. `fillTraitTrade` adds `InvalidTraitFill(fillIndex)` (wrong number of fills, ids or proofs, or a repeated id) and `InvalidTraitProof(fillIndex, tokenId)`; all proofs are checked before anything moves. `claim` reverts with `NothingToClaim` or, if the transfer fails again, `ClaimFailed` (the credit stays).

### Payouts

```text
_payout(to, asset):                      // never reverts
    ok = transferOut(asset, to)          // native: call · ERC-20: trySafeTransfer · ERC-721: transferFrom
    if !ok: credits[to][key(type, token, id)] += amount; emit AssetCredited
```

`claim` zeroes the credit, emits `Claimed`, then transfers and reverts with `ClaimFailed` if that fails (which restores the credit).

### Events

`TradeCreated(id, maker, taker, offered[], requested[], expiry)`, `TradeFilled`, `TradeCancelled`, `TradeReclaimed` (same shape as v1), plus `AssetCredited(account, token, assetType, id, amount)` and `Claimed(...)`.

### Gas (worst case: 10 NFTs each way)

Create **2.2M**, fill **0.9M**. A trade with one asset per side costs roughly 0.2–0.35M to create and 0.09–0.13M to fill.

