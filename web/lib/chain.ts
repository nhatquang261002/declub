import { defineChain } from "viem";
import { monadTestnet as viemMonadTestnet } from "viem/chains";
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from "./config";

/** The chain the app runs on, shared by the wagmi config (browser) and the trait scanner (server). */
export const chain = defineChain({
  ...viemMonadTestnet,
  id: CHAIN_ID,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "MonadVision", url: EXPLORER_URL } },
});
