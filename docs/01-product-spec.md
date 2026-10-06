# 01 · Product Spec

> **De(al) Club: your community's market, owned by its members.**
>
> Every Monad collection and memecoin gets a Club. Members trade inside it, talk in posts they sign and own, and Holders earn a share of the fees their Club's swaps pay.

## 0. De(al) Club

**The problem.** Communities around collections and memecoins create the value: they hold, trade, talk and bring others in. The fees their markets generate, and the conversations that drive them, go to whoever runs the venue. The people generating the value and the people capturing it aren't the same.

**What DeClub does.** It makes the community the product and its market the economy ([ADR 0021](adr/0021-declub-pivot.md)):

| | What | How |
|---|---|---|
| **Gather** | A Club per verified collection or memecoin: its Market, a Board, its Members ranked by Momentum, Holder badges, an Owner and Moderators | [09 · Clubs](09-clubs.md), [ADR 0016](adr/0016-clubs-and-momentum.md) |
| **Trade** | Members swap inside the Club, wallet to wallet or through escrow, with no trust between them | `DeClubEscrow`, `DeClubIntents` (sections 1–8 below) |
| **Own the market** | Each week 40% of the fees a Club's swaps pay goes to its Holders, by holdings, and 20% to its Club fund, which the Owner collects | `DeClubRewards`, [ADR 0022](adr/0022-club-rewards.md) |
| **Own the conversation** | Posts and follows are signed by the member's wallet and exported in full; the reader picks how the Board is ordered | [ADR 0023](adr/0023-signed-posts-and-lenses.md) |

**Why it can't be farmed.** Every completed swap pays the full fee on each side; at most 60% of it comes back, shared with every Holder of the Club. Rewards follow holdings, which cost something to have, not posting, which costs nothing.

**What it isn't.** A rating of assets, or a promise that a Club is safe. Momentum and rewards say a market is busy; the Club still tells you to check every asset before you sign.

The rest of this page is the spec of the trading engine the Clubs run on: where the project started.

---

This is the product spec the project started from, tidied up. It began with Chogs only; the app now trades any ERC-721, ERC-20 and MON through `DeClubEscrow`, plus signed swaps through `DeClubIntents`. Where the engineering design differs from the original text, the change is marked **→ Design** with a link to the reasoning.

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
| 4.4 | Chog #421 | *Any* Chog with Wizard Hat + Blue Eyes, plus 3 MON | ✅ trait request: `createTraitTrade` / `fillTraitTrade` in `DeClubEscrow` ([ADR 0006](adr/0006-trait-requests-in-v2.md)) |
| 4.5 | Chog #421 | "Make me an offer" | ✅ open offer: takers lock proposals, the maker accepts one ([ADR 0007](adr/0007-open-offers.md)) |
| 4.6 | Chog #421, nothing locked | Bob's NFT, or a ring of up to 4 | ✅ signed swap, settled by a matcher ([ADR 0008](adr/0008-trade-intents.md), [0009](adr/0009-ring-swaps.md)) |

## 5. Trade lifecycle (user view)

1. **Create.** Alice picks what she gives, what she wants, an optional counterparty, and an optional expiry. Her side goes into escrow in the same transaction.
2. **Discover.** The deal appears in *Open deals*. A direct request only shows up for the named counterparty.
3. **Fill.** Bob, who owns what Alice asked for, clicks **Accept & swap**. One transaction sends Bob's side to Alice and the escrowed side to Bob.
4. **Or cancel.** Alice can cancel any time before a fill and gets her escrow back.
5. **Or expire.** After the expiry time nobody can fill the trade. Alice, or anyone else, can return the escrow to Alice.

> **→ Design:** the original spec had a separate *accept → both deposit → READY → execute* flow. The escrow merges accept, deposit and execute into one taker transaction, so the taker's assets are never held in escrow and a trade can't get stuck halfway. See [ADR 0001](adr/0001-atomic-fill.md) and [03 · Contract Design](03-contract-design.md#declubescrow-locked-deals).

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

- Trait-based trades (in `DeClubEscrow`)
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

Run it on a deployment of the current source, with `NEXT_PUBLIC_REWARDS_EPOCH_SECONDS` set to a few minutes and `DeClubRewards` deployed with no claim delay. The [user guide](07-user-guide.md) has the full walkthrough.

**The Club story (the hackathon demo):**

1. Alice and Bob sign in. Alice holds two Chogs and joins the Chog Club: she's a **Holder**. Carol owns the Chog contract and **claims** the Club as its Owner.
2. Alice posts on the Board: *"WTB any Chog with a crown"*. Her wallet signs it; the post shows **Signed**. Bob **follows** her and switches the Board's lens to **Following**.
3. Carol links the project's X account under **Manage → The Club on X** with a proof post: the Club page shows "@ChogNFT ✓". Alice posts on X about the Club, mentioning it, and shares the link in a note: the card says **Counts**, and her Momentum rises.
4. Bob and Dave swap Chogs in the Club's Market. Each side pays the fee; the Club's Momentum goes up.
5. The epoch closes. `npm run rewards:epoch -- --publish` splits the Club's share of the fees: 40% to Holders (Alice, with her "+N% active" bonus for her X post; with `X_BEARER_TOKEN` set, its likes and reposts add to it), 20% to the Club fund (Carol). The operator funds it on chain.
6. Alice opens the **Rewards** tab and claims her MON. Carol sees "the Club fund is ready" and collects it.
7. Open `/api/clubs/<Chog>/feed` and `/api/rewards/epochs/<n>`: every post and every payout is public and verifiable.

**The trading engine:**

1. Alice and Bob sign in (Privy, or an injected wallet). Alice holds Chog #421, Bob holds #812.
2. Alice opens **Create**, picks **Lock assets now** and **Request exact assets**: #421 for #812 + 2 MON. She can lock it to Bob by typing his @handle. One transaction locks #421 and her side of the fee.
3. Bob opens the deal page and clicks **Accept & swap**. One transaction.
4. The deal shows **Swapped**. Alice's wallet now holds #812 + 2 MON and Bob's holds #421.
5. Show cancelling a deal and reclaiming an expired one: the assets come back.
6. Show the differentiators: a trait request (*"any Chog with Wizard Hat + Blue Eyes, for #421"*), an open offer with proposals, and a **Sign only** swap that the matcher settles, in a ring if one exists.

## 10. Pitch

> **De(al) Club gives every Monad collection and memecoin a Club where members trade, talk in posts they own, and Holders earn a share of the fees their market pays.**
>
> *The people who make a market should own a piece of it.*

Underneath is a trustless trading engine (**define conditions → lock assets → verify → atomic settlement**) for any ERC-721, ERC-20 and MON; on top, the Club decides where the value goes.
