import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { RPC_URL } from "./config";
import { chain } from "./chain";

export { chain };

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
