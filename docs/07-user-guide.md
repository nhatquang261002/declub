# 07 · User Guide

Chog Swap is a peer-to-peer, non-custodial marketplace for dealing Chogs on Monad.

## How to deal

1. **Connect** an injected wallet and switch to Monad testnet.
2. **Create** a deal from any Create button. Pick a type (open offer, exact assets, or a trait), say what you want, then choose what you give and when it expires. Review it and confirm.
3. **Approve** Chog Swap to transfer your offered Chogs. This is a collection-wide ERC-721 approval and normally only happens once.
4. **Create the deal.** Your offered NFTs and MON are locked in escrow in the same transaction.
5. **Accept a deal** when you own every requested Chog. The taker approves the collection if needed and sends requested MON in the Accept & Swap transaction.
6. **Settle, cancel, or reclaim.** A successful fill swaps both sides atomically. The maker can cancel an open deal, or reclaim it after expiry.

## Safety guidelines

- Confirm the wallet and network before signing.
- Review every token id, MON amount, taker address, and expiry.
- Public deals can be filled by anyone who owns the requested assets; direct deals can only be filled by the named wallet.
- Chog Swap has no platform fee. Wallets still charge network gas.
- The current deployment is a Monad testnet demo with MockChog. Do not use valuable mainnet assets.
- Never approve or send assets to a contract address copied from an untrusted message.

The in-app [Field Guide](../web/app/guide/page.tsx) contains the user-facing FAQ and walkthrough.
