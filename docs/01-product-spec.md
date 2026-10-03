# 01 · Product Spec

> **Trustless OTC trading and programmable escrow on Monad.**
>
> Define the trade. Lock the assets. Let the contract handle the trust.

This is the product spec the project started from, tidied up. It began with Chogs only; the app now trades any ERC-721, ERC-20 and MON through `OnDealV2`, plus signed swaps through `OnDealIntents`. Where the engineering design differs from the original text, the change is marked **→ Design** with a link to the reasoning.

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
| **Non-custodial** | Assets sit in escrow only while a trade is open. No admin can move them. (The fee admin can only change the protocol fee, within a ceiling fixed at deploy.) |
| **Atomic** | Settlement is all-or-nothing. Nobody ends up having sent their side without receiving the other. |
| **Permissionless** | Anyone can create a trade or fill a valid one. |
| **On-chain source of truth** | Trade state comes from the chain, not from the frontend or an indexer. |

## 4. Use cases

| # | Maker gives | Maker wants | Built? |
|---|---|---|---|
| 4.1 | Chog #421 | Chog #812 | ✅ |
| 4.2 | Chog #421 + 2 MON | Chog #812 | ✅ |
| 4.3 | Chog #421 | Chog #812 + 3 MON | ✅ |
| —   | Chog #421, #500 | Chog #812 | ✅ (up to 10 assets per side, any mix of ERC-721, ERC-20 and MON) |
| 4.4 | Chog #421 | *Any* Chog with Wizard Hat + Blue Eyes, plus 3 MON | ✅ trait request: `createTraitTrade` / `fillTraitTrade` in `OnDealV2` ([ADR 0006](adr/0006-trait-requests-in-v2.md)) |
| 4.5 | Chog #421 | "Make me an offer" | ✅ open offer: takers lock proposals, the maker accepts one ([ADR 0007](adr/0007-open-offers.md)) |
| 4.6 | Chog #421, nothing locked | Bob's NFT, or a ring of up to 4 | ✅ signed swap, settled by a matcher ([ADR 0008](adr/0008-trade-intents.md), [0009](adr/0009-ring-swaps.md)) |

## 5. Trade lifecycle (user view)

1. **Create.** Alice picks what she gives, what she wants, an optional counterparty, and an optional expiry. Her side goes into escrow in the same transaction.
2. **Discover.** The deal appears in *Open deals*. A direct request only shows up for the named counterparty.
3. **Fill.** Bob, who owns what Alice asked for, clicks **Accept & swap**. One transaction sends Bob's side to Alice and the escrowed side to Bob.
4. **Or cancel.** Alice can cancel any time before a fill and gets her escrow back.
5. **Or expire.** After the expiry time nobody can fill the trade. Alice, or anyone else, can return the escrow to Alice.

> **→ Design:** the original spec had a separate *accept → both deposit → READY → execute* flow. v1 (and V2 after it) merges accept, deposit and execute into one taker transaction, so the taker's assets are never held in escrow and a trade can't get stuck halfway. See [ADR 0001](adr/0001-atomic-fill.md) and [03 · Contract Design](03-contract-design.md#state-machine).

## 6. Cancellation and expiration

- Only the maker can cancel, and only an open trade.
- Expiry is optional. An expired trade can't be filled.
- Every escrowed asset always ends up either **settled** to the taker or **refunded** to the maker. Nothing stays locked for good.

## 7. Direct trade requests

A maker can address a trade to one wallet (`taker = Bob`). Only Bob can fill it. The maker can also type Bob's X or Discord handle: Privy finds the wallets Bob chose to share, and the deal locks to the one the maker picks ([ADR 0017](adr/0017-deal-by-handle.md)).

- **Accept:** Bob fills it.
- **Reject:** Bob ignores it (the UI can hide it for him). Alice cancels it or lets it expire.

There's no on-chain "reject". It would cost the recipient gas and change nothing, because only the maker can release the escrow.

## 8. MVP scope

**Must have (Phases 1–2)**, all built

- Monad wallet connection: Privy sign-in (Google, X, Discord or a wallet), or an injected wallet without Privy ([ADR 0010](adr/0010-privy-sign-in.md))
- Create a deal: exact NFT ↔ NFT, NFT + MON ↔ NFT, NFT ↔ NFT + MON
- Escrow on create, atomic fill
- Cancel, expiry, reclaiming expired deals
- Deal page and History. History comes from contract storage reads ([ADR 0004](adr/0004-read-deals-from-storage.md)), the server's fill record ([ADR 0012](adr/0012-server-side-saves.md)) and the fill watcher, which follows the chain for fills the app never saw ([ADR 0019](adr/0019-fill-watcher.md))
- Transaction status in the UI
- Contract tests: unit, fuzz and invariant

The original "My Chogs" page is gone: the NFT picker in Create lists what a wallet holds.

**Nice to have (Phase 3)**, built

- Trait-based trades (in `OnDealV2`)
- Direct-request inbox (the **For you** tab)
- Notifications (in-app bell and opt-in browser alerts)
- Search and filters, over the whole book on the server ([ADR 0020](adr/0020-server-side-deal-book.md))

**Phase 4**

- ✅ Any ERC-721 collection, ERC-20s, multi-asset trades ([ADR 0005](adr/0005-generic-asset-model.md))
- ✅ Open offers ([ADR 0007](adr/0007-open-offers.md))
- ✅ Trade intents and automated matching: signed swaps and the matcher ([ADR 0008](adr/0008-trade-intents.md), [`matcher/`](../matcher/README.md))
- ✅ Multi-party (ring) swaps, up to 4 ([ADR 0009](adr/0009-ring-swaps.md))
- ✅ Protocol fee, a flat amount per side of a completed deal, adjustable by a fee admin within a ceiling; raises wait 7 days ([ADR 0015](adr/0015-protocol-fee.md), [0018](adr/0018-adjustable-protocol-fee.md))
- ✅ Verified profiles and deal-by-@handle ([ADR 0011](adr/0011-verified-profiles.md), [0017](adr/0017-deal-by-handle.md), [10 · Privy](10-privy.md))
- ✅ Clubs: a community per verified asset, with Momentum ([ADR 0016](adr/0016-clubs-and-momentum.md), [09 · Clubs](09-clubs.md))
- Reputation (Momentum is the first step)

## 9. Demo script

Run it on a deployment of the current source (the testnet contracts predate the fee; see the [README](../README.md#deployments-monad-testnet-chain-10143)). The [user guide](07-user-guide.md) has the full walkthrough.

1. Alice and Bob sign in (Privy, or an injected wallet). Alice holds Chog #421, Bob holds #812.
2. Alice opens **Create**, picks **Lock assets now** and **Request exact assets**: #421 for #812 + 2 MON. She can lock it to Bob by typing his @handle. One transaction locks #421 and her side of the fee.
3. Bob opens the deal page and clicks **Accept & swap**. One transaction.
4. The deal shows **Swapped**. Alice's wallet now holds #812 + 2 MON and Bob's holds #421.
5. Show cancelling a deal and reclaiming an expired one: the assets come back.
6. Show the differentiators: a trait request (*"any Chog with Wizard Hat + Blue Eyes, for #421"*), an open offer with proposals, and a **Sign only** swap that the matcher settles, in a ring if one exists.

## 10. Pitch

> **On Deal is a trustless OTC marketplace on Monad, powered by programmable escrow and atomic swaps of NFTs, tokens and MON.**
>
> *Trade what you have for what you actually want, without trusting the other side.*

The underlying primitive (**define conditions → lock assets → verify → atomic settlement**) started with Chogs and now covers any ERC-721, ERC-20 and MON.
