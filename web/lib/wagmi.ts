import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { monadTestnet as viemMonadTestnet } from "viem/chains";
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from "./config";

export const chain = defineChain({
  ...viemMonadTestnet,
  id: CHAIN_ID,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "MonadVision", url: EXPLORER_URL } },
});

export const wagmiConfig = createConfig({
  chains: [chain],
  // Any injected wallet: MetaMask, Rabby, Phantom, Backpack, ...
  connectors: [injected()],
  transports: { [chain.id]: http(RPC_URL) },
  // Reads issued in the same tick (e.g. one tokenURI per Chog card) share one multicall.
  batch: { multicall: true },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
