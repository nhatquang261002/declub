import { defineChain } from "viem";
import { monad, monadTestnet } from "viem/chains";
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from "./config";

/** The chain the app runs on, shared by the wagmi config (browser) and the trait scanner (server). */
export const chain = defineChain({
  ...(CHAIN_ID === monad.id ? monad : monadTestnet),
  id: CHAIN_ID,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "MonadVision", url: EXPLORER_URL } },
});
