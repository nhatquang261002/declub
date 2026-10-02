# ADR 0015: A small flat protocol fee, paid by every side of a completed deal

**Status:** Accepted · 2026-10-01 · **Partly superseded by [ADR 0018](0018-adjustable-protocol-fee.md)** (2026-10-02): the amount is no longer fixed at deploy, the ceiling is set per deployment, an escrow deal records its own fee, and an intent signs a `maxFee`. Who pays, when, and in which token stand as below. · Built and tested (contracts, matcher, web), not deployed. The recipient address and the real WMON address are still to be filled in at mainnet deploy. Changes `OnDealV2` and `OnDealIntents`; `OnDeal` (v1) is unchanged. Builds on [ADR 0005](0005-generic-asset-model.md), [0007](0007-open-offers.md), [0008](0008-trade-intents.md) and [0009](0009-ring-swaps.md).

## Context

The contracts take no fee today (`OnDealV2`: "no admin, no fees, no upgradeability"; `OnDealIntents`: "no admin, no fee"). For mainnet the project wants revenue, and the fee has to work for what the app trades:

- Most deals are NFT for NFT. They have no price, and the contracts have no oracle, so a percentage fee would earn nothing on the core flow.
- The fee should stay small, **$2 per side**, and every side pays, so a two-party deal pays $4.
- The contracts have no admin and are immutable, and that promise is worth keeping.
- Escrow deals lead on mainnet, and signed intents (with ring swaps) must charge the same, or volume drifts to whichever path is free.

## Decision

**Both contracts charge a flat fee per side when a deal completes. Nobody pays for a deal that doesn't complete.** Both pay in MON, the chain's gas token: native in escrow, wrapped MON (WMON) in signed deals, because a wallet can't send native MON into a call it didn't make.

### Escrow deals (`OnDealV2`): native MON, escrowed with each side

`FEE` is an immutable amount of MON, equal for every side. A completed deal pays `2 × FEE`.

- **Each side escrows its own share with its assets:**
  - **Maker:** `createTrade`, `createTraitTrade` and `createOpenOffer` take `msg.value` equal to the offered MON plus `FEE`.
  - **Taker:** `fillTrade` and `fillTraitTrade` take the requested MON plus `FEE`. This is one transaction, so the share is paid at once.
  - **Proposer on an open offer:** `propose` takes the proposed MON plus `FEE`, held with the proposal.
  - Anything else reverts with `WrongNativeAmount`, as now. `acceptProposal` stays non-payable: the proposer's share is already in escrow.
- **Released only on completion.** On a fill or an accepted proposal, both shares go to the recipient together. On `cancelTrade`, `reclaimExpired`, `rejectProposal` and `withdrawProposal`, the share is refunded with the rest of that side's escrow.
- **No per-deal storage.** `FEE` is immutable, so every deal owes the same share and the contract knows what to refund or release.
- **Paid and refunded with the existing fallback.** The fee and the refunds use the same try-send-then-credit logic as every other payout (`_payout`), so a recipient or a refund target that rejects MON can never block a fill or cancel. The credit is collected with `claim`.
- **MON, not dollars, on chain.** The $2 is converted to MON at deploy time. MON's price will drift, so the amount is a launch parameter and a redeploy corrects it.
- **As built.** Constructor `OnDealV2(fee, feeRecipient)`; `FEE`, `FEE_RECIPIENT` and `MAX_FEE` are public. `WrongNativeAmount(expected, sent)` now has the fee inside `expected`. A completed deal emits `FeeCharged(tradeId, recipient, 2 × FEE)` once. The refund shares and the fee use the same credit as every other payout, so a recipient or a maker that rejects MON gets a credit for `claim` (a refund merges with the maker's own native credit). The constructor reverts with `FeeTooHigh(fee, max)` above `MAX_FEE` and `NoFeeRecipient()` for a non-zero fee with the zero address.

### Signed intents (`OnDealIntents`): WMON, pulled at settlement

Intents have no native leg and no escrow, and the contract holds nothing between calls ([ADR 0008](0008-trade-intents.md)). The fee follows the same wallet-to-wallet model.

- **Why not native.** `settle` is sent by the matcher, and a wallet can't push native MON into a call it didn't make. Charging native would mean makers prepaying a balance into the contract, which then holds user funds, needs a withdraw function and more reentrancy surface, and breaks the rule above. Not chosen.
- **Fee token and amount.** Immutable `FEE_TOKEN`, the chain's wrapped MON (WMON), and `FEE_AMOUNT`, the same $2 converted to MON at deploy time as in escrow. WMON is a plain wrapper with no issuer, so nobody can pause it or blacklist the recipient. The canonical mainnet address must be checked before deploy.
- **Pulled at settlement, per maker.** For every maker in the cycle, `settle` transfers `FEE_AMOUNT` of `FEE_TOKEN` from the maker straight to the recipient, with the same pattern as an asset move. A pair pays $4, a three-way ring $6, a four-way ring $8: every side pays. A cycle that doesn't settle charges nothing, and there is no escrow to refund.
- **Signed, so it's consented to.** The `Intent` struct gains `feeToken` and `fee` (after `want`, before `deadline`), and `settle` requires them to equal the contract's immutables, or reverts with `WrongFee(intent, feeToken, fee)`. The wallet's signing prompt then shows the fee, and a signature can't be reused with another one. This changes the type hash and bumps the EIP-712 domain version to `"2"`.
- **As built.** Constructor `OnDealIntents(feeToken, feeAmount, feeRecipient)`; `FEE_TOKEN`, `FEE_AMOUNT`, `FEE_RECIPIENT` and `MAX_FEE` are public. After every `give` has moved, `settle` takes the fee from each maker with `safeTransferFrom` and emits one `FeeCharged(recipient, token, n × fee)`. The constructor refuses a fee above `MAX_FEE`, a non-zero fee with a non-contract token (`InvalidFeeToken`) or without a recipient (`NoFeeRecipient`); a zero fee needs neither. Because the fee moves after the gives, WMON that a maker receives in the same cycle could pay it, but the pool and the app don't count on that: they require the balance up front.
- **Needs a balance and an approval.** A maker must hold WMON and approve the contract for it, as for any asset they give. If the maker also gives WMON, the balance and the allowance have to cover both. The review step offers "Wrap X MON into WMON" and then one approval, so a person with only MON needs no other token (the wrap step calls `deposit()`, the WETH9 interface). The pool refuses an intent whose maker lacks either (`fee_balance`, `fee_allowance`) or that signs another fee (`wrong_fee`), prunes live ones that lose them, and the matcher skips and blames them like any broken give.
- **Still custody-free.** The contract never holds the fee: it goes from maker to recipient inside `settle`, so "never the owner or holder of any asset after a call" stays true.

### Both paths

- **Taken only when the deal succeeds.** "Succeeds" means the fill, the accepted proposal or the `settle` completes. A failed call reverts, so nothing moves. A deal that is cancelled, expires, is rejected or is withdrawn pays nothing. The one thing that happens before success is that an escrow share is *held* with its side's assets, never paid out, and it always comes back (credited for `claim` if the refund target rejects MON).
- **Fixed at deploy.** Amount, token (intents) and recipient are `immutable`, with a constant ceiling (`MAX_FEE = 500 ether`, about $2 until MON falls to roughly $0.004) so a typo can't set an absurd fee. A zero fee is allowed (tests, testnet). A zero recipient with a non-zero fee is refused. There is no owner, no setter and no way to raise it.
- **Visible on-chain and in the app.** A `FeeCharged` event on completion, public getters for the fee and recipient, and a "protocol fee" line in the create review, the fill and propose steps, and the signing step. It says the fee is only charged when the deal completes. The amount comes from the contract, not from config.
- **Recipient.** A Safe multisig (or another contract wallet) that can receive MON and WMON. Privy's Treasury Management workspace doesn't list Monad, so it isn't an option for the dashboard.

## What it does not do

- **No spam deterrent.** Escrow shares are refunded and intents charge only on settlement, so listing or signing junk costs only gas. A non-refundable listing fee would deter that, but it would charge deals that never complete. Not chosen.
- **No discounts, tiers or exemptions.** In particular none by collection: the verified list ([ADR 0014](0014-verified-collections-list.md)) is off-chain and the contracts can't read it.
- **No fee on price.** Value in a deal isn't measured.
- **Doesn't touch v1.** `OnDeal` stays fee-free.

## Consequences

- **Escrow users need MON up front.** A maker needs `FEE` more than the offered MON at create, and a taker needs `FEE` on top of gas. Locking it for the life of a deal is a small cost, and a refund covers an abandoned one.
- **Intent signers need WMON.** A wrap and an approval before signing is one more step than escrow has, and the UI must show it, and the fee, before the signing step, not after a failed match. Someone holding only MON is fine.
- **Ring cost scales with the ring.** A four-way ring pays $8. That is consistent ("every side pays") and still small next to what a ring unlocks. Re-measure the worst-case gas (3.3M today) with four extra token transfers.
- **Price drift in both paths.** The fee is a fixed amount of MON, so its dollar value moves with MON's price. A redeploy corrects it. No stablecoin means no issuer risk, which a pausable or blacklisting token would have added.
- **Accounting grows by the shares.** The escrow contract's native balance is open escrow plus shares held for open deals and active proposals plus unclaimed credits. The invariant tests must say so.
- **Changing the fee means redeploying.** A new deployment costs little here (old trades finish under their old terms, and the app can point at the new address), but the screens must always read the fee from the contract.
- **The ABI and signing change.** `OnDealV2`'s create, fill and propose value rules and constructor; `OnDealIntents`' `Intent` struct, domain version, constructor and `settle`. The V2 library layer and screens, the intent library (`web/lib/intents.ts`), the matcher and pool, and the error copy change with them. Following [ADR 0007](0007-open-offers.md), the sources change in place; nothing is on mainnet yet, and the testnet addresses change on redeploy.
- **Tests:**
  - Escrow: the exact `msg.value` on every payable entry; both shares released on fill and on accept; every cancel, reclaim, reject and withdraw refunding the share; a recipient or refund target that rejects MON gets a credit and the call still succeeds; the invariants with shares.
  - Intents: every maker charged once per settlement; wrong `fee` or `feeToken` rejected; a maker without balance or approval reverts the whole cycle; the new digest matches the matcher's and the web's.
  - Both: the constructor guards.
- **Docs to change when built:** the "no fee" statements for both contracts in their comments, `03-contract-design.md`, `04-security.md` and ADR 0008, plus the user guide and Guide section.
- **Audit:** do this before the external review, so the fee is part of what gets reviewed. The intents contract already gets the closest look.
- **Still open:** the canonical WMON address on mainnet and the recipient address, both given to the deploy scripts (`FEE_TOKEN`, `FEE_RECIPIENT`, `PROTOCOL_FEE_WEI`). Testnet uses `MockWMON` (`DEPLOY_MOCK_WMON=true`). Whether collecting fees has legal or tax consequences is for the project's own advisers, not decided here.
- **Measured:** the worst-case ring (4 makers × 10 NFTs each way) costs about 3.39M gas with the fee, against 3.32M without, so `MAX_CYCLE` stays at 4. Coverage on both contracts is 100%, and the invariants carry the shares (V2: native balance = open escrow + one share per open trade and per active proposal + credits; fees received = 2 × fee per completed deal) and N6 (intents: the recipient holds exactly the fee for every settled maker).
- **Not covered:** approvals for the fee are exact per intent, like every other approval, so a maker with several live intents needs an allowance for all of them or the later ones go `stale` until it is topped up.
