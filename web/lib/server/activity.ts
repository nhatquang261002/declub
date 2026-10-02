import {
  createPublicClient,
  decodeEventLog,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { onDealV2Abi } from "../abi";
import { toAsset, type Asset, type RawAsset } from "../assets";
import { chain } from "../chain";
import { CHAIN_ID, ON_DEAL_V2_ADDRESS, RPC_URL } from "../config";
import type { ActivityEvent } from "../clubs";
import type { ActivityKind } from "../momentum";
import { registry } from "../verifiedAssets";
import type { Store } from "./store";

/**
 * The activity log behind Clubs and Momentum (ADR 0016). There is no indexer and the public RPC
 * can't scan logs back to the deploy block, so, like fill history (ADR 0012), the app reports each
 * transaction it sends and the server reads the receipt itself: nothing in the request but the
 * hash is trusted, and a fake or repeated report records nothing new.
 *
 * One event goes into the log of every Club token it names. Deals made outside the app are missed
 * until a watcher feeds the same function (docs/09-clubs.md).
 */

/** What this module needs from a receipt, so tests can hand one in without a node. */
export type ReceiptLike = {
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[]; logIndex: number }[];
};

/** The chain reads `ingestTx` makes. Real in production (`viemReader`), a fake in tests. */
export type Reader = {
  /** null while the node doesn't have the receipt yet. */
  receipt(hash: Hex): Promise<ReceiptLike | null>;
  /** Unix seconds. */
  timestamp(block: bigint): Promise<number>;
  trade(contract: Address, id: bigint): Promise<{ offered: readonly RawAsset[]; requested: readonly RawAsset[] }>;
  proposalAssets(contract: Address, tradeId: bigint, proposalId: bigint): Promise<readonly RawAsset[]>;
};

export type { ActivityEvent };

/** The oldest events age out past this, per Club. */
export const MAX_EVENTS_PER_CLUB = 5_000;

export const activityKey = (token: string) => `ondeal:activity:${CHAIN_ID}:${token.toLowerCase()}`;

let cached: PublicClient | undefined;
const client = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient);

export function viemReader(): Reader {
  return {
    async receipt(hash) {
      try {
        return await client().getTransactionReceipt({ hash });
      } catch (error) {
        if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
        throw error;
      }
    },
    async timestamp(block) {
      return Number((await client().getBlock({ blockNumber: block })).timestamp);
    },
    async trade(contract, id) {
      return client().readContract({ address: contract, abi: onDealV2Abi, functionName: "getTrade", args: [id] });
    },
    async proposalAssets(contract, tradeId, proposalId) {
      const proposal = await client().readContract({
        address: contract,
        abi: onDealV2Abi,
        functionName: "getProposal",
        args: [tradeId, proposalId],
      });
      return proposal.assets;
    },
  };
}

/** The OnDealV2 contracts whose events count. V2 is optional (see lib/config.ts). */
export const ACTIVITY_CONTRACTS: Address[] = ON_DEAL_V2_ADDRESS ? [ON_DEAL_V2_ADDRESS] : [];

export type IngestOptions = {
  reader?: Reader;
  contracts?: readonly Address[];
  /** Which tokens have a Club. Events that name none are dropped, so the log can't grow unbounded. */
  isClub?: (token: string) => boolean;
};

export type ActivityResult =
  | { status: "recorded"; events: number }
  /** The node doesn't have the receipt yet (or there is no such transaction). Worth retrying. */
  | { status: "pending" };

const tokensOf = (assets: readonly RawAsset[]): string[] =>
  assets.map(toAsset).filter((a): a is Asset => a !== null && a.kind !== "native").map((a) => a.token.toLowerCase());

const distinct = (list: string[]) => [...new Set(list)];

/** Reads the transaction's receipt and records what it did to each Club's asset. */
export async function ingestTx(store: Store, hash: Hex, options: IngestOptions = {}): Promise<ActivityResult> {
  const reader = options.reader ?? viemReader();
  const receipt = await reader.receipt(hash);
  if (!receipt) return { status: "pending" };
  return { status: "recorded", events: await recordActivity(store, hash, receipt, options) };
}

/** The part of `ingestTx` after the receipt is in hand, for callers that already have one. */
export async function recordActivity(store: Store, hash: Hex, receipt: ReceiptLike, options: IngestOptions = {}): Promise<number> {
  // A reverted transaction emitted nothing that counts.
  if (receipt.status !== "success") return 0;
  const reader = options.reader ?? viemReader();
  const watched = (options.contracts ?? ACTIVITY_CONTRACTS).map((c) => c.toLowerCase());
  const isClub = options.isClub ?? ((token: string) => registry.clubFor(token) !== null);

  type Decoded = ReturnType<typeof decodeEventLog<typeof onDealV2Abi>>;
  const decoded: { log: ReceiptLike["logs"][number]; event: Decoded }[] = [];
  for (const log of receipt.logs) {
    if (!watched.includes(log.address.toLowerCase())) continue;
    try {
      decoded.push({ log, event: decodeEventLog({ abi: onDealV2Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] }) });
    } catch {
      // Not an event of this contract's ABI.
    }
  }

  // An accepted proposal fills the deal for its proposer: the proposal's assets are the other side.
  const accepted = new Map<string, bigint>();
  for (const { log, event } of decoded) {
    if (event.eventName === "ProposalAccepted") accepted.set(`${log.address.toLowerCase()}:${event.args.tradeId}`, event.args.proposalId);
  }

  const found: { id: string; kind: ActivityKind; contract: string; deal: bigint; parties: string[]; tokens: string[] }[] = [];
  for (const { log, event } of decoded) {
    const contract = log.address.toLowerCase();
    const id = `${hash.toLowerCase()}:${log.logIndex}`;
    if (event.eventName === "TradeCreated") {
      const tokens = distinct(tokensOf([...event.args.offered, ...event.args.requested]));
      found.push({ id, kind: "created", contract, deal: event.args.tradeId, parties: [event.args.maker.toLowerCase()], tokens });
    } else if (event.eventName === "TradeFilled") {
      const trade = await reader.trade(log.address, event.args.tradeId);
      const proposalId = accepted.get(`${contract}:${event.args.tradeId}`);
      const proposal = proposalId === undefined ? [] : await reader.proposalAssets(log.address, event.args.tradeId, proposalId);
      const tokens = distinct(tokensOf([...trade.offered, ...trade.requested, ...proposal]));
      found.push({
        id,
        kind: "swapped",
        contract,
        deal: event.args.tradeId,
        parties: [event.args.maker.toLowerCase(), event.args.taker.toLowerCase()],
        tokens,
      });
    }
  }

  const relevant = found.filter((f) => f.tokens.some(isClub));
  if (relevant.length === 0) return 0;

  const at = await reader.timestamp(receipt.blockNumber);
  const block = Number(receipt.blockNumber);
  for (const f of relevant) {
    const event: ActivityEvent = { id: f.id, kind: f.kind, contract: f.contract, deal: f.deal.toString(), block, at, parties: f.parties, tokens: f.tokens };
    const member = JSON.stringify(event);
    for (const token of f.tokens.filter(isClub)) {
      await store.rank(activityKey(token), [{ member, score: at }], MAX_EVENTS_PER_CLUB);
    }
  }
  return relevant.length;
}

/** A Club's logged events, newest first. Rows that don't parse are skipped. */
export async function readActivity(store: Store, token: string, limit = MAX_EVENTS_PER_CLUB): Promise<ActivityEvent[]> {
  const rows = await store.ranked(activityKey(token), limit);
  const events: ActivityEvent[] = [];
  for (const row of rows) {
    try {
      const e = JSON.parse(row) as ActivityEvent;
      if (typeof e.id === "string" && typeof e.at === "number" && Array.isArray(e.parties)) events.push(e);
    } catch {
      // A damaged row is dropped, not fatal.
    }
  }
  return events;
}
