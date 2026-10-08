import { createPublicClient, erc20Abi, http, type Address, type Hex, type PublicClient } from "viem";
import { chain } from "../chain";
import type { AssetPrize } from "../challenges";
import { RPC_URL } from "../config";

/**
 * The chain reads an asset prize needs (ADR 0050): an ERC-20's decimals when a challenge starts,
 * and the receipt of the transaction an Owner says paid a winner. Real in production
 * (`viemPrizeChain`), a fake in tests. The app never holds a prize: it only reads what was sent.
 */
export type PrizeReceipt = {
  status: "success" | "reverted";
  /** The block's time, in seconds. */
  at: number;
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[];
};

export type PrizeChain = {
  /** The token's `decimals()`, or null when it doesn't answer. */
  decimals(token: Address): Promise<number | null>;
  /** The receipt of `tx` with its block's time, or null while there is none. Throws when the chain can't be read. */
  receipt(tx: Hex): Promise<PrizeReceipt | null>;
};

let cachedClient: PublicClient | undefined;
const client = () => (cachedClient ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

export function viemPrizeChain(): PrizeChain {
  return {
    async decimals(token) {
      try {
        return Number(await client().readContract({ address: token, abi: erc20Abi, functionName: "decimals" }));
      } catch {
        return null;
      }
    },
    async receipt(tx) {
      let receipt;
      try {
        receipt = await client().getTransactionReceipt({ hash: tx });
      } catch (error) {
        if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
        throw error;
      }
      const block = await client().getBlock({ blockNumber: receipt.blockNumber });
      return { status: receipt.status, at: Number(block.timestamp), logs: receipt.logs };
    },
  };
}

/** keccak256("Transfer(address,address,uint256)"): the same topic for ERC-20 and ERC-721. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type PrizeProblem = "tx_failed" | "tx_too_early" | "wrong_asset" | "wrong_recipient" | "too_little";

const topicAddress = (topic: Hex) => `0x${topic.slice(26)}`.toLowerCase();

/**
 * Why `receipt` doesn't pay `amount` of `asset` to `to` (the winner's linked wallets, lowercase), or
 * null when it does. It must have succeeded, in a block at or after `notBefore` (epoch ms, when the
 * challenge settled), and hold Transfer logs of the asset's own contract to those wallets: an ERC-20
 * adding up to at least `amount` base units (topics: from, to; data: value), or ERC-721 transfers of
 * at least `amount` distinct token ids (topics: from, to, id). Transfers elsewhere don't count.
 */
export function prizeProblem(receipt: PrizeReceipt, asset: Pick<AssetPrize, "token" | "kind">, amount: string, to: ReadonlySet<string>, notBefore: number): PrizeProblem | null {
  if (receipt.status !== "success") return "tx_failed";
  if (receipt.at * 1000 < notBefore) return "tx_too_early";
  const nft = asset.kind === "erc721";
  const transfers = receipt.logs.filter(
    (l) => l.address.toLowerCase() === asset.token.toLowerCase() && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics.length === (nft ? 4 : 3),
  );
  if (transfers.length === 0) return "wrong_asset";
  const mine = transfers.filter((l) => to.has(topicAddress(l.topics[2]!)));
  if (mine.length === 0) return "wrong_recipient";
  const got = nft ? BigInt(new Set(mine.map((l) => BigInt(l.topics[3]!))).size) : mine.reduce((sum, l) => sum + (l.data === "0x" ? 0n : BigInt(l.data)), 0n);
  return got >= BigInt(amount) ? null : "too_little";
}
