import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { PRIVY_APP_ID, RPC_URL } from "./config";
import { chain } from "./chain";

export { chain };

const shared = {
  chains: [chain],
  transports: { [chain.id]: http(RPC_URL) },
  // Reads issued in the same tick (e.g. one tokenURI per Chog card) share one multicall.
  batch: { multicall: true },
  ssr: true,
} as const;

// With a Privy app id, Privy supplies the connectors (its embedded wallet and any wallet the user
// signs in with), so none are listed here. Without one, any injected wallet works: MetaMask,
// Rabby, Phantom, Backpack, ...
export const wagmiConfig = PRIVY_APP_ID
  ? createPrivyConfig(shared)
  : createConfig({ ...shared, connectors: [injected()] });

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
