# ADR 0010: Privy sign-in and linked accounts

**Status:** Accepted · 2026-10-01 · Frontend only. No contract, matcher or pool change.

## Context

The app connects injected wallets only. Anyone without MetaMask or Rabby can't use it, and mobile browsers have no injected wallet at all. Wagmi's WalletConnect route needs its own project id and a separate modal.

## Decision

**Add Privy as an optional layer under wagmi.** `NEXT_PUBLIC_PRIVY_APP_ID` switches it on; blank keeps the injected-wallet connect, so the app still runs (and builds) without a Privy account.

- **Wallet-first.** People already own a wallet. Sign-in is Google, X, Discord or "wallet" (listed first), and a social account is another way into a wallet, in both directions:
  - *Wallet first, social later:* sign in with the wallet, then link Google / X / Discord on `/account`. Next time the social account signs in.
  - *Social first, wallet later:* a social sign-in with no wallet connected shows **Link a wallet** in the header. If a wallet is already linked but not connected in this browser (the usual return visit), it shows **Connect wallet** with the linked address.
  - Several linked wallets: `/account` shows which one is in use and switches between connected ones.
- **Embedded wallets are opt-in** (`NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=true`, and enabled in the Privy dashboard). Off by default, so nobody is given a wallet they didn't bring. When on, a social sign-in with no wallet creates one.
- **wagmi stays the interface.** `@privy-io/wagmi` swaps the config and provider; every `useReadContract`, `useWriteContract` and `useSignTypedData` call is unchanged. Embedded wallets are EOAs, so EIP-712 intents and the contracts' `msg.sender` assumptions hold as before.
- **Linked accounts** live on `/account`: link or unlink email, Google, X, Discord and extra wallets, and export the embedded wallet's key. Linking is for sign-in and recovery. **Nothing is shown to other traders**: showing a maker's verified handle needs a server that maps address to Privy user, which this ADR does not add. That belongs with the reputation work.
- **Chain:** Monad testnet is passed as Privy's `defaultChain` and only supported chain.

## Consequences

- `@privy-io/wagmi` pins viem to exactly `2.56.0`, so the app pins viem to match. Privy's optional smart-wallet peer (`permissionless`) wants a different `ox`, so installs need `--legacy-peer-deps`, and `@stripe/stripe-js@^1` is added by hand because Privy's on-ramp screens import it.
- Without embedded wallets, a person with no wallet can't trade. Turning them on fixes that, and an embedded wallet starts with no MON, so testnet users still need a faucet.
- Each approval and transaction shows Privy's confirmation modal for embedded wallets.
- Smart wallets, gas sponsorship and batching are **not** part of this. They would make `msg.sender` a contract wallet and need their own review (ERC-1271 for intents works already; escrow and `withdraw` need checking).
