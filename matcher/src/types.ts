import type { Address, Hex } from "viem";

/** Numerically aligned with `IOnDealIntents.AssetType` (and V2). Native is never valid here. */
export const AssetType = { Native: 0, ERC20: 1, ERC721: 2 } as const;

export interface Asset {
  assetType: number;
  token: Address;
  id: bigint;
  amount: bigint;
}

/** What a maker signs. Mirrors `IOnDealIntents.Intent`. */
export interface Intent {
  maker: Address;
  give: Asset[];
  want: Asset[];
  /**
   * The protocol fee token, and the most the maker agrees to pay if the cycle settles (ADR 0015,
   * 0018). The contract charges its current `fee()`, which must not be above `maxFee`.
   */
  feeToken: Address;
  maxFee: bigint;
  deadline: bigint;
  nonce: bigint;
}

export interface SignedIntent {
  intent: Intent;
  signature: Hex;
}

/** Lifecycle of an intent in the pool. Only `open` intents are matched. */
export type Status =
  | "open" //      plausible on-chain and waiting for a counterparty
  | "stale" //     balance, ownership or approval is missing right now; revives if it comes back
  | "settled" //   settled by this matcher
  | "cancelled" // the maker asked the pool to drop it
  | "expired" //   past its deadline
  | "consumed" //  nonce used on-chain by someone else (settled elsewhere, or invalidated)
  | "rejected"; // can never settle (bad signature, malformed, token that doesn't deliver)

export const TERMINAL: ReadonlySet<Status> = new Set([
  "settled",
  "cancelled",
  "expired",
  "consumed",
  "rejected",
]);
