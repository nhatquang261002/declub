import { createPublicClient, decodeEventLog, getAddress, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { chain } from "../chain";
import { CHAIN_ID, CHOG_SWAP_ADDRESS, CHOG_SWAP_V2_ADDRESS, RPC_URL } from "../config";
import type { ReceiptLike } from "./activity";
import type { Store } from "./store";

/**
 * Fill history (ADR 0012). Who filled a public deal is recorded only in the `TradeFilled` event, and
 * the public RPC can't scan logs back to the deploy block, so the app reports each fill it
 * sends and the server checks it against the chain: it reads the receipt itself and trusts nothing
 * in the request but the transaction hash. A fake or repeated report records nothing new.
 *
 * `TradeFilled(tradeId, maker, taker)` is emitted by `fillTrade`, `fillTraitTrade` and, for an
 * accepted proposal (the proposer is the taker), `acceptProposal`, in both contracts, so one event
 * covers every way a deal gets filled.
 */
const abi = parseAbi(["event TradeFilled(uint256 indexed tradeId, address indexed maker, address indexed taker)"]);

/** The swap contracts whose fills are kept. V2 is optional (see lib/config.ts). */
export const FILL_CONTRACTS: Address[] = [CHOG_SWAP_ADDRESS, ...(CHOG_SWAP_V2_ADDRESS ? [CHOG_SWAP_V2_ADDRESS] : [])];

/** A wallet can't have filled more than this many deals; the oldest records age out past it. */
const MAX_FILLS_PER_ACCOUNT = 2_000;

export const fillsKey = (contract: string, account: string) =>
  `chogswap:fills:${CHAIN_ID}:${contract.toLowerCase()}:${account.toLowerCase()}`;

export const isFillContract = (address: string) => FILL_CONTRACTS.some((c) => c.toLowerCase() === address.toLowerCase());

let cached: PublicClient | undefined;
const client = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

export type IngestResult =
  | { status: "recorded"; fills: number }
  /** The node doesn't have the receipt yet (or there is no such transaction). Worth retrying. */
  | { status: "pending" };

/** Records every `TradeFilled` this transaction emitted from a watched contract. */
export async function ingestFills(store: Store, hash: Hex): Promise<IngestResult> {
  let receipt;
  try {
    receipt = await client().getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return { status: "pending" };
    throw error;
  }
  return { status: "recorded", fills: await recordFills(store, receipt) };
}

/** The part of `ingestFills` after the receipt is in hand: the number of fills recorded. */
export async function recordFills(store: Store, receipt: ReceiptLike): Promise<number> {
  // A reverted transaction emitted nothing that counts.
  if (receipt.status !== "success") return 0;

  const score = Number(receipt.blockNumber);
  let fills = 0;
  for (const log of receipt.logs) {
    if (!isFillContract(log.address)) continue;
    let event;
    try {
      event = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    } catch {
      continue;
    }
    await store.rank(fillsKey(log.address, getAddress(event.args.taker)), [{ member: event.args.tradeId.toString(), score }], MAX_FILLS_PER_ACCOUNT);
    fills++;
  }
  return fills;
}

/** Trade ids `account` has filled on `contract`, newest first. */
export async function listFills(store: Store, contract: string, account: string): Promise<string[]> {
  return store.ranked(fillsKey(contract, account), MAX_FILLS_PER_ACCOUNT);
}
