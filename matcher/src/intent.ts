import {
  type Address,
  type Hex,
  hashStruct,
  hashTypedData,
  isAddressEqual,
  zeroAddress,
} from "viem";
import { type Asset, AssetType, type Intent } from "./types.ts";

export const MAX_CYCLE = 4;
export const MAX_ASSETS_PER_SIDE = 10;

export const domain = (chainId: number, verifyingContract: Address) =>
  ({ name: "OnDealIntents", version: "2", chainId, verifyingContract }) as const;

export const types = {
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
    { name: "feeToken", type: "address" },
    { name: "fee", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** Not part of the contract: a maker-signed request to the pool to drop an intent. */
export const cancelTypes = {
  CancelIntent: [{ name: "intentHash", type: "bytes32" }],
} as const;

/** What the contract charges each maker in a settled cycle (`FEE_TOKEN`, `FEE_AMOUNT`). */
export interface FeeTerms {
  token: Address;
  amount: bigint;
}

/** The signed fee has to be the one the contract charges, or `settle` reverts with `WrongFee`. */
export function feeProblem(intent: Intent, terms: FeeTerms): string | null {
  if (!isAddressEqual(intent.feeToken, terms.token) || intent.fee !== terms.amount) {
    return `the fee must be ${terms.amount} of ${terms.token}`;
  }
  return null;
}

/** The EIP-712 struct hash. It is the id the contract emits in `IntentFilled`. */
export function intentHash(intent: Intent): Hex {
  return hashStruct({ data: intent, primaryType: "Intent", types });
}

/** The digest a maker signs. */
export function intentDigest(chainId: number, swap: Address, intent: Intent): Hex {
  return hashTypedData({
    domain: domain(chainId, swap),
    types,
    primaryType: "Intent",
    message: intent,
  });
}

export function cancelDigest(chainId: number, swap: Address, hash: Hex): Hex {
  return hashTypedData({
    domain: domain(chainId, swap),
    types: cancelTypes,
    primaryType: "CancelIntent",
    message: { intentHash: hash },
  });
}

/** `type:token:id`, lower-case. ERC-20 has id 0. Two assets are the same asset iff keys match. */
export function assetKey(a: Asset): string {
  return `${a.assetType}:${a.token.toLowerCase()}:${a.id}`;
}

export function sameAsset(a: Asset, b: Asset): boolean {
  return a.assetType === b.assetType && isAddressEqual(a.token, b.token) && a.id === b.id;
}

/** ERC-20 wants are floors, NFTs match exactly. Same rule as the contract's `_requireCovered`. */
export function covers(gives: Asset[], want: Asset[]): boolean {
  return want.every((w) => gives.some((g) => sameAsset(g, w) && g.amount >= w.amount));
}

/**
 * The contract's per-intent rules (`_validateIntent`), minus the `token.code.length` check which
 * needs the chain. Returns the first problem, or null.
 */
export function shapeProblem(intent: Intent): string | null {
  if (isAddressEqual(intent.maker, zeroAddress)) return "maker is the zero address";
  if (intent.deadline === 0n) return "deadline must be non-zero";
  for (const side of ["give", "want"] as const) {
    const assets = intent[side];
    if (assets.length === 0) return `${side} is empty`;
    if (assets.length > MAX_ASSETS_PER_SIDE) {
      return `${side} has more than ${MAX_ASSETS_PER_SIDE} assets`;
    }
    for (const [i, a] of assets.entries()) {
      if (a.assetType === AssetType.ERC20) {
        if (a.id !== 0n || a.amount === 0n) return `${side}[${i}]: ERC-20 needs id 0 and amount > 0`;
      } else if (a.assetType === AssetType.ERC721) {
        if (a.amount !== 1n) return `${side}[${i}]: ERC-721 needs amount 1`;
      } else {
        return `${side}[${i}]: only ERC-20 and ERC-721 can be used (wrap MON as WMON)`;
      }
      if (assets.slice(0, i).some((b) => sameAsset(a, b))) return `${side}[${i}]: duplicate asset`;
    }
  }
  for (const g of intent.give) {
    if (intent.want.some((w) => sameAsset(g, w))) return "the same asset is on both sides";
  }
  return null;
}
