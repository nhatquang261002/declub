# ADR 0018: An adjustable protocol fee, capped at deploy, with raises on a delay

**Status:** Accepted · 2026-10-02 · Supersedes the "fixed at deploy" parts of [ADR 0015](0015-protocol-fee.md). Changes `OnDealV2` and `OnDealIntents` before their mainnet deploy; `OnDeal` (v1) is not deployed to mainnet. Who pays the fee, when it is paid, and in which token stay as ADR 0015 decided. The amount is per NFT a side moves from [ADR 0033](0033-fee-per-nft.md) on.

## Context

ADR 0015 made the fee amount, token and recipient immutable, priced at $2 in MON at deploy, and said a redeploy corrects drift. That redeploy costs users more than it looked:

- **Approvals start over.** NFT and ERC-20 approvals name the contract, so every user approves every collection again for the new address.
- **Liquidity splits.** Open escrow deals finish on the old contract, so the app, History and Clubs follow two addresses.
- **Live intents die.** A signature names the contract (`verifyingContract`), so the whole pool goes invalid at once.
- **Every price move is a migration.** MON is volatile, and a fixed amount in MON drifts in dollars both ways.

A launch at **$5 per side** was also chosen, so the fee needs to be able to come down quickly if it hurts volume.

## Decision

**The fee amount can be changed by a fee admin, within a ceiling fixed at deploy. A cut applies at once; a raise waits 7 days. The admin can renounce, which fixes the fee for good.** Both contracts share this logic (`src/FeeAdmin.sol`).

### What is still fixed at deploy

- **`FEE_RECIPIENT`**: immutable, a Safe that can receive MON and WMON. Nothing can redirect fees.
- **`MAX_FEE`**: immutable ceiling, set at deploy to about **4× the launch fee** (it used to be the constant 500 MON). The constructor refuses a ceiling above `MAX_FEE_LIMIT` (500 MON), so a unit typo can't set an absurd one.
- **`FEE_TOKEN`** (intents): immutable WMON, as before.
- **`FEE_RAISE_DELAY`**: the constant 7 days.

### What the admin can do

- **`setFee(newFee)`**, at most `MAX_FEE`:
  - **Equal or lower:** applies at once and drops any queued raise. `setFee(fee())` is how a queued raise is cancelled.
  - **Higher:** is queued as `pendingFee`, usable from `pendingFeeAt = now + 7 days`. A new call replaces the queued one and restarts the clock.
- **`applyFee()`**: makes a queued raise live once its time has come, and only within `FEE_APPLY_WINDOW` (7 days) after that; a stale raise reverts with `FeeRaiseExpired` and has to be queued again, so users always get a fresh notice. Admin only.
- **`transferFeeAdmin(next)`** then **`acceptFeeAdmin()`** from `next`: a two-step handover, so a typo can't hand the role to nobody.
- **`renounceFeeAdmin()`**: sets the admin to zero and drops any queued raise or handover. After that the fee never changes.
- **Nothing else.** The admin can't touch escrow, credits, nonces, the recipient, the token or the ceiling, and can't pause anything.
- **Who holds it:** a **separate** Safe from the recipient, so neither key set can both set and receive fees. A zero admin at deploy gives a fixed fee from the start (tests, testnet).
- **Events:** `FeeChangeQueued(newFee, effectiveAt)`, `FeeChanged(oldFee, newFee)`, `FeeAdminTransferStarted(current, next)`, `FeeAdminTransferred(previous, next)`. Errors: `NotFeeAdmin`, `FeeTooHigh(fee, max)`, `NoPendingFee`, `FeeRaiseNotReady(effectiveAt)`, `NotPendingFeeAdmin`.

### Escrow deals (`OnDealV2`): the fee is fixed per deal, when it is created

- **`Trade.fee` (`uint96`)** records `fee()` at `createTrade`, `createTraitTrade` and `createOpenOffer`. It packs beside `taker`, so it costs no extra storage slot.
- **Both sides pay the deal's own fee.** The maker sends `offered native + fee()` at create. The taker (`fillTrade`, `fillTraitTrade`) and every proposer (`propose`) send their native amount plus **`t.fee`**, not the current fee. So nobody's deal changes under them: after a raise, deals already listed keep their old price, and after a cut, a maker who wants the lower fee cancels and lists again.
- **Refunds and release use `t.fee`.** Cancel, reclaim, reject and withdraw return `t.fee` to that side. A completed deal sends `2 × t.fee` and emits `FeeCharged(tradeId, recipient, 2 × t.fee)`.
- **The app must read `getTrade(id).fee`** for fills and proposals, and `fee()` only for a new listing. `WrongNativeAmount(expected, sent)` still names the exact amount.

### Signed intents (`OnDealIntents`): the signed fee is a maximum

- **`Intent.fee` becomes `Intent.maxFee`.** The wallet prompt then says what the maker agrees to: "at most this much". This changes the type hash, and the EIP-712 domain version goes to `"3"`.
- **`settle` requires `feeToken == FEE_TOKEN` and `maxFee >= fee()`**, or reverts with `WrongFee(intent, feeToken, maxFee)`. It charges the **current** `fee()` from each maker.
- **A cut keeps every live intent valid and charges less.** A raise makes the intents signed below it stale; the pool prunes them as `wrong_fee`, and their makers sign again.
- **Approvals stay exact.** The app approves the intent's `maxFee` (the current fee when it was signed). A cut leaves a harmless leftover allowance. A second live intent still needs its own top-up (`fee_allowance`), as ADR 0015 noted.

### Launch values

- **$5 per side**, converted to a round number of MON at deploy, so a pair pays about $10 and a four-way ring about $20.
- **`MAX_FEE` about 4× that**, about $20 per side at launch prices.
- **Check it covers settlement gas:** the fee must cover what the matcher pays for the worst-case ring (about 3.4M gas).

## What it does not do

- **No oracle, no dollar peg.** The admin keeps the fee near its dollar target by hand. A stale price feed that blocks fills is worse than a fee that is a little off.
- **No change to a deal already listed.** A deal keeps the fee it was listed with until it completes or ends.
- **No raise without warning.** Seven days is enough for a maker to cancel and for the app to show the coming fee.
- **No discounts or tiers.** One fee for everyone, as in ADR 0015.
- **No v1 on mainnet.** `OnDeal` has no fee and would be a free path, so it is not deployed there. The app treats it as testnet-only.

## Consequences

- **"No admin" becomes "an admin over the fee amount only".** The contract comments, `03-contract-design.md` and `04-security.md` say so. The security table gains the fee admin: it can change the amount up to `MAX_FEE`, with raises delayed 7 days, and nothing else.
- **ABI changes.**
  - `OnDealV2`: `FEE()` becomes `fee()`, `Trade` gains `fee`, and the constructor becomes `(fee, maxFee, feeRecipient, feeAdmin)`.
  - `OnDealIntents`: `FEE_AMOUNT()` becomes `fee()`, `Intent.fee` becomes `maxFee`, the domain version is `"3"`, and the constructor becomes `(feeToken, fee, maxFee, feeRecipient, feeAdmin)`.
  - Both gain the admin functions and getters (`feeAdmin`, `pendingFee`, `pendingFeeAt`, `pendingFeeAdmin`).
- **The matcher re-reads the fee.** It is no longer constant, so the pool checks `maxFee >= fee()` against a fee it re-reads each tick. Balance and allowance checks use the current fee.
- **The app shows a queued raise.** When `pendingFee` is set, the fee line says what it will become and when.
- **Tests:**
  - **Admin:** cut, queue, apply too early, apply, replace, cancel by setting the same fee, a ceiling breach, the two-step handover, renounce, and everything a non-admin is refused.
  - **Escrow:** a deal listed before a raise or cut fills, proposes, cancels and refunds at its own fee. Invariant V9 becomes "the recipient holds `2 × t.fee` per completed deal".
  - **Intents:** a cut settles intents signed at the old fee and charges the new one. A raise rejects them. N6 uses the fee in force at each settlement.
- **Operations.** A runbook to re-check the MON price and adjust (for example, monthly, or when the fee leaves $3–$8). The admin Safe's signers are kept apart from the recipient's.
- **Audit scope** includes `FeeAdmin` and the per-deal fee.
- **Deploy scripts** take `PROTOCOL_FEE_WEI`, `PROTOCOL_FEE_MAX_WEI`, `FEE_RECIPIENT` and `FEE_ADMIN`.
