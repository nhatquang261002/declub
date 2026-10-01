"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PRIVY_APP_ID, PRIVY_EMBEDDED_WALLETS } from "@/lib/config";
import { chain, wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "./Toast";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 4_000 } } }),
  );

  const app = <ToastProvider>{children}</ToastProvider>;

  if (!PRIVY_APP_ID) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Wallet-first: people bring a wallet (MetaMask & co.) and link socials to it, or sign in
        // with a social that is already linked to one. Embedded wallets are opt-in (see config).
        loginMethods: ["google", "twitter", "discord", "wallet"],
        appearance: { theme: "dark", showWalletLoginFirst: true },
        embeddedWallets: {
          ethereum: { createOnLogin: PRIVY_EMBEDDED_WALLETS ? "users-without-wallets" : "off" },
        },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>{app}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
