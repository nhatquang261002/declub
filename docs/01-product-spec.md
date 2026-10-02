# 01 · Product Spec

> **Trustless OTC trading and programmable escrow for Chogs on Monad.**
>
> Define the trade. Lock the assets. Let the contract handle the trust.

This is the product spec the project started from, tidied up. Where the engineering design differs from the original text, the change is marked **→ Design** with a link to the reasoning.

---

## 1. Problem

NFT marketplaces are built around **NFT → token**. Holders often want something else:

- **My NFT → another NFT**
- **My NFT + MON → a specific NFT**

Trading directly (OTC) runs into a trust problem. Alice owns Chog #421 and Bob owns Chog #812. Alice offers `#421 + 2 MON` for Bob's Chog. Someone has to send first. If the other side never sends, there's no recourse, and no neutral party guarantees the exchange.

## 2. Solution

A smart contract holds the assets in escrow and settles the trade **atomically**: every transfer in the trade happens, or none of them do.

```text
Alice                         Bob
Chog #421 + 2 MON     ⇄      Chog #812

After settlement:
Alice → Chog #812
Bob   → Chog #421 + 2 MON
```

Neither party has to trust the other.

## 3. Core principles

| Principle | Meaning |
|---|---|
| **Trustless** | The contract enforces the trade's conditions. |
| **Non-custodial** | Assets sit in escrow only while a trade is open. No admin can move them. |
| **Atomic** | Settlement is all-or-nothing. Nobody ends up having sent their side without receiving the other. |
| **Permissionless** | Anyone can create a trade or fill a valid one. |
| **On-chain source of truth** | Trade state comes from the chain, not from the frontend or an indexer. |

## 4. Use cases

| # | Maker gives | Maker wants | v1? |
|---|---|---|---|
| 4.1 | Chog #421 | Chog #812 | ✅ |
| 4.2 | Chog #421 + 2 MON | Chog #812 | ✅ |
| 4.3 | Chog #421 | Chog #812 + 3 MON | ✅ |
| —   | Chog #421, #500 | Chog #812 | ✅ (a side can hold several Chogs, up to the per-side limit) |
| 4.4 | Chog #421 | *Any* Chog with Wizard Hat + Blue Eyes, up to 3 MON extra | Phase 3 |

## 5. Trade lifecycle (user view)

1. **Create.** Alice picks what she gives, what she wants, an optional counterparty, and an optional expiry. Her side goes into escrow in the same transaction.
2. **Discover.** The trade appears in *Open Trades*. A direct request only shows up for the named counterparty.
3. **Fill.** Bob, who owns what Alice asked for, clicks **Accept & Swap**. One transaction sends Bob's side to Alice and the escrowed side to Bob.
4. **Or cancel.** Alice can cancel any time before a fill and gets her escrow back.
5. **Or expire.** After the expiry time nobody can fill the trade. Alice, or anyone else, can return the escrow to Alice.

> **→ Design:** the original spec had a separate *accept → both deposit → READY → execute* flow. v1 merges accept, deposit and execute into one taker transaction, so the taker's assets are never held in escrow and a trade can't get stuck halfway. See [ADR 0001](adr/0001-atomic-fill.md) and [03 · Contract Design](03-contract-design.md#state-machine).

## 6. Cancellation and expiration

- Only the maker can cancel, and only an open trade.
- Expiry is optional. An expired trade can't be filled.
- Every escrowed asset always ends up either **settled** to the taker or **refunded** to the maker. Nothing stays locked for good.

## 7. Direct trade requests

A maker can address a trade to one wallet (`taker = Bob`). Only Bob can fill it.

- **Accept:** Bob fills it.
- **Reject:** Bob ignores it (the UI can hide it for him). Alice cancels it or lets it expire.

There's no on-chain "reject". It would cost the recipient gas and change nothing, because only the maker can release the escrow.

## 8. MVP scope

**Must have (Phases 1–2)**

- Monad wallet connection
- Chog NFT display ("My Chogs")
- Create a trade: exact NFT ↔ NFT, NFT + MON ↔ NFT, NFT ↔ NFT + MON
- Escrow on create, atomic fill
- Cancel, expiry, reclaiming expired trades
- Trade detail and history (built from on-chain events)
- Transaction status in the UI
- Contract tests: unit, fuzz and invariant

**Nice to have (Phase 3)**

- Trait-based trades
- Direct-request inbox
- Notifications
- Search and filters

**Future (Phase 4)**

- Any ERC-721 collection, ERC-20s, multi-asset trades
- Trade intents and automated matching
- Multi-party (ring) swaps
- Reputation

## 9. Demo script

1. Alice owns #421. Bob owns #812. Both are MockChogs on Monad testnet.
2. Alice creates **#421 → #812 + 2 MON**. The escrow panel shows `Alice ✓ · Bob ✗`.
3. Bob opens the trade and clicks **Accept & Swap**. One transaction.
4. The trade shows **FILLED**. Alice's wallet now holds #812 + 2 MON and Bob's holds #421.
5. Show cancelling a trade and reclaiming an expired one: the assets come back.
6. Close with the differentiator (Phase 3, or a mock-up): *"Any Chog with Wizard Hat + Blue Eyes, for #421 + up to 3 MON."*

## 10. Pitch

> **On Deal is a trustless OTC marketplace for Chogs on Monad, powered by programmable escrow and atomic NFT swaps.**
>
> *Trade what you have for what you actually want, without trusting the other side.*

The underlying primitive (**define conditions → lock assets → verify → atomic settlement**) extends from Chogs to trading any on-chain asset.
