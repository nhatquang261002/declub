# 07 · User Guide

Chog Swap is a peer-to-peer, non-custodial marketplace for dealing Chogs on Monad.

## How to deal

1. **Connect** an injected wallet and switch to Monad testnet.
2. **Create** a deal from any Create button. Pick a type (open offer, exact assets, or a trait), say what you want, then choose what you give and when it expires. Review it and confirm.
3. **Approve** Chog Swap to transfer your offered Chogs. This is a collection-wide ERC-721 approval and normally only happens once.
4. **Create the deal.** Your offered NFTs and MON are locked in escrow in the same transaction.
5. **Accept a deal** when you own every requested Chog. The taker approves the collection if needed and sends requested MON in the Accept & Swap transaction.
6. **Settle, cancel, or reclaim.** A successful fill swaps both sides atomically. The maker can cancel an open deal, or reclaim it after expiry.

## Locked deals or signed swaps

When signed swaps are enabled (`NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS`), step 1 of Create asks how the deal settles. Both end in the same list, tagged **Locked** or **Signed**.

| | Lock assets now | Sign only |
|---|---|---|
| Can it fail? | No. Once someone accepts, both sides move together | Yes, if you move the asset or revoke the approval before a match |
| Cost | Gas to create, and again to cancel; approvals too | Free to post and remove; approvals only |
| Your assets | Held by the contract | Stay in your wallet |
| Can use | MON, NFTs, tokens, trait requests | NFTs and tokens (MON as WMON); no traits |
| Who can take it | Anyone, one named wallet, or one of the offers you get | Anyone that meets your terms; a matcher finds pairs and rings of up to 4 |
| Ends | Accepted, cancelled, or expired and reclaimed | Settled, removed from the pool, or its deadline passes (10 minutes to 7 days) |

**Lock** when the other side must be certain it will go through: a specific buyer, a high-value trade, anything with MON or a trait. **Sign** for quick NFT and token swaps where you'd rather not lock anything.

The create screen shows six short reasons as chips (*Can't fail*, *Costs gas*, *Assets locked*, *Free*, *Nothing locked*, *Can fail*). Each has a tooltip and links to its own entry in the in-app Guide (`/guide#cant-fail`, `#costs-gas`, `#assets-locked`, `#free`, `#nothing-locked`, `#can-fail`). The wording for all of them lives in one file, `web/lib/settlementTerms.ts`, which the tooltips and the Guide page both read; change a reason there and both follow. The reasoning behind the two paths is in [ADR 0008](adr/0008-trade-intents.md) and [ADR 0009](adr/0009-ring-swaps.md).

## Safety guidelines

- Confirm the wallet and network before signing.
- Review every token id, MON amount, taker address, and expiry.
- Public deals can be filled by anyone who owns the requested assets; direct deals can only be filled by the named wallet.
- Multi-asset and signed deals charge a small flat protocol fee per side, only when the deal completes ([ADR 0015](adr/0015-protocol-fee.md)); the screens show the exact amount before you confirm. Single-collection deals on the original contract have no fee. Wallets also charge network gas.
- The current deployment is a Monad testnet demo with MockChog. Do not use valuable mainnet assets.
- Never approve or send assets to a contract address copied from an untrusted message.

The in-app [Field Guide](../web/app/guide/page.tsx) contains the user-facing FAQ and walkthrough.
