import {
  type Address,
  type Chain,
  type Hex,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { intentsAbi } from "./abi.ts";
import type { FeeTerms } from "./intent.ts";

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

/** What the contract charges (`FEE_TOKEN`, `FEE_AMOUNT`) and where it goes. Read once at start. */
export async function readFeeTerms(
  reader: Reader,
  swap: Address,
): Promise<FeeTerms & { recipient: Address }> {
  const [token, amount, recipient] = await Promise.all([
    reader.readContract({ address: swap, abi: intentsAbi, functionName: "FEE_TOKEN" }),
    reader.readContract({ address: swap, abi: intentsAbi, functionName: "FEE_AMOUNT" }),
    reader.readContract({ address: swap, abi: intentsAbi, functionName: "FEE_RECIPIENT" }),
  ]);
  return { token, amount, recipient };
}
