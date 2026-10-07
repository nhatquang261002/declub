# ADR 0033: The protocol fee is paid per NFT, and a side moves at most 5

**Status:** Accepted · 2026-10-07 · Supersedes the "flat per side" amount of [ADR 0015](0015-protocol-fee.md) and [ADR 0018](0018-adjustable-protocol-fee.md). Who pays, when, in which token, who can change the amount and how stay as those decided. Changes `DeClubEscrow` and `DeClubIntents` (testnet redeploy; mainnet is not deployed yet), the matcher, the app and the e2e scenarios.

## Context

A deal holds up to 10 assets a side, taken all together or not at all ([ADR 0001](0001-atomic-fill.md), [0005](0005-generic-asset-model.md)). The fee was flat per side, so a bundle of ten NFTs paid what one NFT paid:

- **Fewer fee events for the same volume.** Ten NFTs moved in one deal is one completed deal and one fee. Club Rewards are paid out of fees ([ADR 0022](0022-club-rewards.md)), so a bundle shrinks the pool the Holders and the Owner share.
- **Bundling is the cheapest way to move volume.** Anyone who cares about the fee puts everything in one deal.
- **The fee can't follow the deal's worth.** A percentage needs a price, and an NFT-for-NFT deal has none on-chain; the contracts have no oracle ([ADR 0015](0015-protocol-fee.md)). Pricing NFTs needs an off-chain signer the contracts would have to trust, which was weighed and not chosen.

## Decision

**A side pays the fee once for every NFT it moves, and once if it moves none.** The amount per NFT is the fee ADR 0018 already defines: set at deploy, changed by the fee admin within `MAX_FEE`, a raise after 7 days.

`feeUnits(side) = max(1, NFTs on the side)`, where an `ERC721` counts 1 and an `ERC721Trait` request counts its `amount`. MON and tokens don't count, so "1 NFT for 500 MON" still costs one unit a side, and a MON-for-tokens side costs one.

**A side can move at most 5 NFTs** (`MAX_NFTS_PER_SIDE = 5`, new). `MAX_ASSETS_PER_SIDE` stays 10, so five NFTs can still travel with MON and tokens. The cap bounds the most one deal can cost (5 × the fee a side) and keeps the worst-case gas lower than before. `TooManyNfts(count, max)` is the error; a trait request is checked before it is added to the sum, so a huge `amount` can't overflow it.

### Escrow (`DeClubEscrow`)

- A side sends `native amount + fee × feeUnits(side)` with its call: the maker at `createTrade`, `createTraitTrade` and `createOpenOffer`, a proposer at `propose`, the taker at `fillTrade` and `fillTraitTrade`.
- `Trade.fee` still records the fee per NFT in force when the deal was listed, for both sides. A later raise or cut never touches a deal already listed, and a proposer pays what the maker listed with.
- The contract still only **holds** the shares. A completed deal (a fill or an accepted proposal) releases `fee × (units(offered) + units(requested or the proposal))` in one `FeeCharged`. Cancel, reclaim, reject and withdraw refund that side's own units: the maker's at the maker's `offered`, a proposer's at that proposal's assets.
- New views: `feeUnits(Asset[])` and `MAX_NFTS_PER_SIDE()`. Stored sides are counted again at refund and charge time (at most 10 assets), so the `Trade` struct and the ABI of every existing call are unchanged.

### Signed swaps (`DeClubIntents`)

- Each maker in a settled cycle pays `fee() × (NFTs in their give, at least 1)` in WMON from their wallet, one transfer each. `FeeCharged.amount` is the sum.
- **`maxFee` is the most the maker will pay per NFT.** It is signed with the rest of the intent, and the NFT count is signed in `give`, so the total is bounded by what the signature already says. The intent's EIP-712 type is unchanged, and so is the check `maxFee >= fee()`. A fee raised above `maxFee` still makes the intent stale.
- Both `give` and `want` are capped at 5 NFTs (`TooManyNfts(intent, give, count)`). A `want` is matched by the previous maker's `give`, so a `want` over the cap could never be met anyway; refusing it early gives the maker a clear error.

### What reads the fee

- **Club Rewards, History and Momentum read `FeeCharged`**, so the fee a Club earns follows the NFTs moved with no change to the epoch builder.
- **Momentum still counts a completed swap once per wallet** (`swapWeight`), not per NFT. It scores that a market is busy; the fee pays for the volume. Changing it is a separate decision.
- **The matcher** checks a maker holds and has approved `fee × units(give)` of WMON (`fee_balance`, `fee_allowance`) and refuses an intent over 5 NFTs a side before the chain does.
- **The app** quotes the total and, for more than one NFT, the sum ("2 MON for each of your 3 NFTs"), sends the right `value`, and stops the form at the fifth NFT.

## Consequences

- A bundle of n NFTs pays what n single-NFT deals pay, so the fee pool is the same whether people bundle or not, and no longer depends on how they shape a deal.
- A side with ten fungible assets and no NFT still pays one unit. That is deliberate: the deal still completes once, and fungible volume has no NFT to count. If it turns out to leave volume unpriced, a percentage on native MON (read from the asset itself, no oracle) can be added beside it later.
- A deal that moves 5 NFTs a side costs up to 10 times the fee a one-NFT deal costs. The ceiling is still per NFT, so a compromised fee admin's worst case grows by the same factor, with the same 7-day notice on a raise (see [04-security](../04-security.md)).
- Deals listed on the previous testnet deployment stay on it. Every existing signature stops verifying with the new contract's address, as with any redeploy ([ADR 0018](0018-adjustable-protocol-fee.md)); the pool starts empty.

## Alternatives considered

- **A percentage of the deal's worth.** Needs a price per asset. MON and WMON can be read exactly, but NFT-for-NFT has no price on-chain. A signed valuation from the protocol server prices NFTs, at the cost of a trusted signer the contract depends on and a fee that follows a floor price instead of what the NFT is worth. Kept as an option, not built.
- **Only lower `MAX_ASSETS_PER_SIDE`** to 3. Caps the problem and leaves the fee flat per side; it is still cheaper to bundle than to trade one by one.
- **Let a taker fill part of a bundle.** Breaks the all-or-nothing deal ([ADR 0001](0001-atomic-fill.md)) and the escrow accounting.
- **Count Momentum per NFT only.** Off-chain, so it would do nothing for the fee.
