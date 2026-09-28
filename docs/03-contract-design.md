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
| `TradeFilled(id, maker, taker)` | `fillTrade` | all |
| `TradeCancelled(id, maker)` | `cancelTrade` | all |
| `TradeReclaimed(id, maker, caller)` | `reclaimExpired` | all |
| `WithdrawalCredited(account, amount)` | `_sendMon` on failure | account |
| `Withdrawn(account, amount)` | `withdraw` | account |

`TradeCreated` carries all the terms, so a client can rebuild every trade from logs alone and then call `getTrade` only to confirm the live status.

## Errors

`EmptySide`, `MonOnBothSides`, `TooManyTokens(count, max)`, `ExpiryInPast(expiry)`, `TradeNotOpen(id)`, `TradeIsExpired(id)`, `TradeNotExpired(id)`, `NotMaker(id)`, `NotAllowedTaker(id)`, `SelfFill(id)`, `WrongMonAmount(expected, sent)`, `NothingToWithdraw`, `WithdrawFailed`.

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

Shape of option A: add `bytes32 requestedRoot` and `uint8 requestedAnyCount` to `Trade`, and a `fillTrade(id, uint256[] anyIds, bytes32[][] proofs)` overload. The fill checks `MerkleProof.verify(proof, root, keccak256(abi.encode(id)))`.

"Up to 3 MON" becomes the taker's choice of payment within a bound. Keep it simple: the maker's `offeredMon` is an exact amount. Price negotiation stays off-chain for now.

## Phase 4: generalized assets

```solidity
enum AssetType { ERC721, ERC20, NATIVE }
struct Asset { AssetType assetType; address token; uint256 tokenId; uint256 amount; }
```

Replace `offeredIds/offeredMon` with `Asset[] offered` and do the same for the requested side. Add a token allowlist (or accept any token and warn in the UI). ERC-20 transfers use `SafeERC20`, and fee-on-transfer tokens are rejected by checking balances before and after. Multi-party ring swaps become an `n`-leg trade where every leg's assets are escrowed and settlement runs once all legs are funded, with refunds after expiry.
