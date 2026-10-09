import { CHAIN_ID } from "./config";

/**
 * The app's flavor: testnet or mainnet, picked by NEXT_PUBLIC_CHAIN_ID at build time. Everything a
 * screen says about the network comes from here, so a mainnet build never claims to be a demo.
 */
type Network = {
  chainId: number;
  mainnet: boolean;
  /** "Monad testnet" / "Monad", as it reads in a sentence. */
  name: string;
  /** What a wallet calls it, e.g. in "Switch to Monad Testnet". */
  walletName: string;
};

export const networkFor = (chainId: number): Network =>
  chainId === 143
    ? { chainId, mainnet: true, name: "Monad mainnet", walletName: "Monad" }
    : { chainId, mainnet: false, name: "Monad testnet", walletName: "Monad Testnet" };

export const NETWORK = networkFor(CHAIN_ID);
