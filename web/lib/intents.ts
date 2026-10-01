import { getAddress, hashStruct, isAddress, type Address, type Hex } from "viem";
import { toAsset, toRawAsset, type Asset } from "./assets";
import { CHAIN_ID, MAX_TOKENS_PER_SIDE } from "./config";
import { sameAddress } from "./deals";
import type { DealV2 } from "./dealsV2";

// Signed trade intents (ADR 0008, 0009). Everything here mirrors matcher/src/intent.ts and
// matcher/src/wire.ts: the EIP-712 types, the struct hash that identifies an intent, and the
// JSON the pool speaks. The contract is the authority; if these drift, signatures stop verifying.

/** An intent only holds ERC-20s and NFTs (`kind` is never "native" or "trait"). */
export type Intent = {
  maker: Address;
  give: Asset[];
  want: Asset[];
  deadline: bigint;
  nonce: bigint;
};

export const INTENT_TYPES = {
  Asset: [
    { name: "assetType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "id", type: "uint256" },
    { name: "amount", type: "uint256" },
  ],
  Intent: [
    { name: "maker", type: "address" },
    { name: "give", type: "Asset[]" },
    { name: "want", type: "Asset[]" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** Not part of the contract: a maker-signed request that the pool drop an intent. */
export const CANCEL_TYPES = {
  CancelIntent: [{ name: "intentHash", type: "bytes32" }],
} as const;

export const intentDomain = (verifyingContract: Address, chainId = CHAIN_ID) =>
  ({ name: "ChogSwapIntents", version: "1", chainId, verifyingContract }) as const;

const message = (intent: Intent) => ({
  maker: intent.maker,
  give: intent.give.map(toRawAsset),
  want: intent.want.map(toRawAsset),
  deadline: intent.deadline,
  nonce: intent.nonce,
});

/** What the wallet is asked to sign for an intent. */
export const intentTypedData = (verifyingContract: Address, intent: Intent) =>
  ({
    domain: intentDomain(verifyingContract),
    types: INTENT_TYPES,
    primaryType: "Intent",
    message: message(intent),
  }) as const;

/** What the wallet is asked to sign to take an intent out of the pool. */
export const cancelTypedData = (verifyingContract: Address, intentHash: Hex) =>
  ({
    domain: intentDomain(verifyingContract),
    types: CANCEL_TYPES,
    primaryType: "CancelIntent",
    message: { intentHash },
  }) as const;

/** The EIP-712 struct hash: the id the pool uses and the contract emits in `IntentFilled`. */
export const intentHash = (intent: Intent): Hex =>
  hashStruct({ data: message(intent), primaryType: "Intent", types: INTENT_TYPES });

// ─────────────────────────────────────────────────────────────── The pool's JSON

/** Every bigint is a decimal string. */
export type WireAsset = { assetType: number; token: Address; id: string; amount: string };
export type WireIntent = {
  maker: Address;
  give: WireAsset[];
  want: WireAsset[];
  deadline: string;
  nonce: string;
};

const wireAsset = (a: Asset): WireAsset => {
  const raw = toRawAsset(a);
  return { assetType: raw.assetType, token: raw.token, id: raw.id.toString(), amount: raw.amount.toString() };
};

export const intentToWire = (intent: Intent): WireIntent => ({
  maker: intent.maker,
  give: intent.give.map(wireAsset),
  want: intent.want.map(wireAsset),
  deadline: intent.deadline.toString(),
  nonce: intent.nonce.toString(),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uint = (v: unknown) => (typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) ? BigInt(v) : null);

function parseAsset(v: unknown): Asset | null {
  if (!isRecord(v) || typeof v.assetType !== "number" || typeof v.token !== "string" || !isAddress(v.token)) return null;
  const id = uint(v.id);
  const amount = uint(v.amount);
  if (id === null || amount === null) return null;
  const asset = toAsset({ assetType: v.assetType, token: getAddress(v.token), id, amount });
  // An intent can't hold MON or a trait request. Anything else is not something this app wrote.
  return asset && (asset.kind === "erc20" || asset.kind === "erc721") ? asset : null;
}

function parseSide(v: unknown): Asset[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map(parseAsset);
  return out.every((a): a is Asset => a !== null) ? out : null;
}

export function intentFromWire(v: unknown): Intent | null {
  if (!isRecord(v) || typeof v.maker !== "string" || !isAddress(v.maker)) return null;
  const give = parseSide(v.give);
  const want = parseSide(v.want);
  const deadline = uint(v.deadline);
  const nonce = uint(v.nonce);
  if (!give || !want || deadline === null || nonce === null) return null;
  return { maker: getAddress(v.maker), give, want, deadline, nonce };
}

export type IntentStatus = "open" | "stale" | "settled" | "cancelled" | "expired" | "consumed" | "rejected";
const STATUSES: ReadonlySet<string> = new Set<IntentStatus>([
  "open", "stale", "settled", "cancelled", "expired", "consumed", "rejected",
]);

/** One row of the pool's book. */
export type PoolIntent = {
  hash: Hex;
  status: IntentStatus;
  /** Why it is stale or rejected, in the matcher's words. */
  reason: string | null;
  createdAt: number;
  settlementTx: Hex | null;
  intent: Intent;
  signature: Hex;
};

/**
 * Reads one row of the pool's JSON. The hash is recomputed from the terms, so a pool can't make
 * the app show one thing under another intent's id (cancel acts on that id). Returns null for
 * anything that doesn't check out; the lists just leave it out.
 */
export function parsePoolIntent(v: unknown): PoolIntent | null {
  if (!isRecord(v) || typeof v.status !== "string" || !STATUSES.has(v.status)) return null;
  if (typeof v.hash !== "string" || typeof v.signature !== "string") return null;
  const intent = intentFromWire(v.intent);
  if (!intent || intentHash(intent).toLowerCase() !== v.hash.toLowerCase()) return null;
  return {
    hash: intentHash(intent),
    status: v.status as IntentStatus,
    reason: typeof v.reason === "string" ? v.reason : null,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
    settlementTx: typeof v.settlementTx === "string" ? (v.settlementTx as Hex) : null,
    intent,
    signature: v.signature as Hex,
  };
}

/** A settled cycle: `cycle[i].give` went to `cycle[(i + 1) % n].maker`. Two intents is a plain swap. */
export type Settlement = {
  txHash: Hex;
  blockNumber: number;
  at: number;
  cycle: PoolIntent[];
};

export function parseSettlement(v: unknown): Settlement | null {
  if (!isRecord(v) || typeof v.txHash !== "string" || !Array.isArray(v.cycle)) return null;
  const cycle = v.cycle.map(parsePoolIntent);
  // A row the pool no longer has (or one that doesn't check out) makes the cycle unreadable.
  if (cycle.length < 2 || !cycle.every((r): r is PoolIntent => r !== null)) return null;
  return {
    txHash: v.txHash as Hex,
    blockNumber: typeof v.blockNumber === "number" ? v.blockNumber : 0,
    at: typeof v.at === "number" ? v.at : 0,
    cycle,
  };
}

/** Who each maker in a settled cycle paid, and who paid them. */
export function ringLegs(cycle: readonly PoolIntent[]) {
  return cycle.map((row, i) => ({
    row,
    to: cycle[(i + 1) % cycle.length]!.intent.maker,
    from: cycle[(i + cycle.length - 1) % cycle.length]!.intent.maker,
    // What this maker received: the previous maker's give, in full (surplus over `want` included).
    received: cycle[(i + cycle.length - 1) % cycle.length]!.intent.give,
  }));
}

// ─────────────────────────────────────────────────────────────── Status copy

export const STATUS_LABEL: Record<IntentStatus, string> = {
  open: "Open",
  stale: "Paused",
  settled: "Settled",
  cancelled: "Cancelled",
  expired: "Expired",
  consumed: "Used elsewhere",
  rejected: "Dropped",
};

/** What a status means for the maker, in one sentence. */
export const STATUS_HELP: Record<IntentStatus, string> = {
  open: "Waiting for a match. It settles on its own when intents that fit are found.",
  stale: "The matcher skips it for now because your wallet can't honour it. It comes back by itself once it can.",
  settled: "Matched and swapped on-chain.",
  cancelled: "Removed from the pool. A copy of the signature elsewhere could still settle until it expires.",
  expired: "Its deadline passed, so it can no longer settle.",
  consumed: "Its nonce was used, so this signature can't settle any more.",
  rejected: "The matcher gave up on it after it failed on-chain checks.",
};

/** Statuses that can still settle (the pool keeps them, the matcher may pick them up). */
export const isLive = (status: IntentStatus) => status === "open" || status === "stale";

/** Plain-language reading of the matcher's `reason` ("allowance: 0x…: allowance 0 < 5"). */
export function reasonText(reason: string | null): string | null {
  if (!reason) return null;
  const code = reason.split(":")[0];
  const copy: Record<string, string> = {
    balance: "You no longer hold everything this intent gives.",
    allowance: "Your token approval for this intent is missing or too small.",
    not_owner: "You no longer own an NFT this intent gives.",
    not_approved: "An NFT this intent gives isn't approved for On Deal any more.",
    bad_token: "A token in this intent stopped answering.",
    nonce_used: "This intent's nonce was already used.",
    expired: "This intent's deadline passed.",
  };
  return (code && copy[code]) || reason;
}

// ─────────────────────────────────────────────────────────────── Posting

/** How long a new intent lives. Short by default: a signature that left the pool can't be recalled. */
export const DEADLINES = [
  { key: "10m", label: "10 minutes", seconds: 600 },
  { key: "1h", label: "1 hour", seconds: 3_600 },
  { key: "6h", label: "6 hours", seconds: 21_600 },
  { key: "24h", label: "24 hours", seconds: 86_400 },
  { key: "7d", label: "7 days", seconds: 604_800 },
] as const;
export type DeadlineKey = (typeof DEADLINES)[number]["key"];
export const DEFAULT_DEADLINE: DeadlineKey = "1h";

export const deadlineSeconds = (key: DeadlineKey) => DEADLINES.find((d) => d.key === key)!.seconds;

/** The contract's per-intent rules, for the form. The pool and the contract are the backstop. */
export function intentProblem(give: readonly Asset[], want: readonly Asset[]): string | null {
  if (give.length === 0) return "Add something to give.";
  if (want.length === 0) return "Add something you want in return.";
  if (give.length > MAX_TOKENS_PER_SIDE || want.length > MAX_TOKENS_PER_SIDE) {
    return `Up to ${MAX_TOKENS_PER_SIDE} assets per side.`;
  }
  const same = (a: Asset, b: Asset) => a.kind === b.kind && sameAddress(a.token, b.token) && a.id === b.id;
  if (give.some((g) => want.some((w) => same(g, w)))) {
    return "The same asset can't be on both sides. Give and ask for different assets.";
  }
  return null;
}

/** Where a nonce lives in the contract's bitmap, for `invalidateNonces(word, mask)`. */
export const nonceBit = (nonce: bigint) => ({ word: nonce >> 8n, mask: 1n << (nonce & 0xffn) });

// ─────────────────────────────────────────────────────────────── In the deals list

/**
 * A signed intent shaped like a V2 deal, so deals and signed swaps can share one list and one set
 * of filters (search, MON, sort). `id` is -1n so a numeric search never matches it; the card links
 * by `signed.hash` instead. An intent has no counterparty, so `taker` is always null.
 */
export type SignedListing = DealV2 & { signed: PoolIntent };

export const intentAsListing = (row: PoolIntent): SignedListing => ({
  id: -1n,
  maker: row.intent.maker,
  taker: null,
  expiry: row.intent.deadline,
  status: isLive(row.status) ? "open" : row.status === "settled" ? "filled" : "cancelled",
  offered: row.intent.give,
  requested: row.intent.want,
  signed: row,
});

export const isSignedListing = (listing: DealV2): listing is SignedListing => "signed" in listing;
