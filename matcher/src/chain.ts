import { type Address, type Chain, type Hex, createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { intentsAbi } from "./abi.ts";

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  /** Set when the chain has Multicall3 (Monad testnet does, a bare anvil doesn't). */
  multicall3?: Address;
  /** How often to poll for a receipt. viem's default is 4s, far longer than a Monad block. */
  pollingIntervalMs?: number;
}

export function makeChain(cfg: ChainConfig): Chain {
  return defineChain({
    ...monadTestnet,
    id: cfg.chainId,
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    contracts: cfg.multicall3 ? { multicall3: { address: cfg.multicall3 } } : {},
  });
}

/** Read-only client. With Multicall3, the many small reads of a prune pass batch into one call. */
export function makeReader(cfg: ChainConfig) {
  return createPublicClient({
    chain: makeChain(cfg),
    transport: http(cfg.rpcUrl),
    pollingInterval: cfg.pollingIntervalMs ?? 250,
    batch: cfg.multicall3 ? { multicall: true } : undefined,
  });
}
export type Reader = ReturnType<typeof makeReader>;

export function makeSender(cfg: ChainConfig, privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain: makeChain(cfg),
    transport: http(cfg.rpcUrl),
  });
  return { account, wallet };
}
export type Sender = ReturnType<typeof makeSender>;

/** The fee token and recipient, both fixed at deploy. Read once at start. */
export async function readFeeSetup(reader: Reader, swap: Address): Promise<{ token: Address; recipient: Address }> {
  const [token, recipient] = await Promise.all([
    reader.readContract({ address: swap, abi: intentsAbi, functionName: "FEE_TOKEN" }),
    reader.readContract({ address: swap, abi: intentsAbi, functionName: "FEE_RECIPIENT" }),
  ]);
  return { token, recipient };
}

/** The fee each maker pays right now. The fee admin can change it, so read it when it's needed. */
export function readFee(reader: Reader, swap: Address): Promise<bigint> {
  return reader.readContract({ address: swap, abi: intentsAbi, functionName: "fee" });
}
