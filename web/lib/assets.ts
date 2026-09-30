import { formatUnits, zeroAddress, type Address } from "viem";
import { formatMon } from "./format";

/** Mirrors IChogSwapV2.AssetType. */
export const ASSET_TYPE = { native: 0, erc20: 1, erc721: 2 } as const;
export type AssetKind = "native" | "erc20" | "erc721";
const KIND: Record<number, AssetKind> = { 0: "native", 1: "erc20", 2: "erc721" };

/** One line of a V2 trade side. Native has token 0x0 and id 0; ERC-20 has id 0; ERC-721 has amount 1. */
export type Asset = {
  kind: AssetKind;
  token: Address;
  id: bigint;
  amount: bigint;
};

/** The shape `getTrade` returns for one asset (IChogSwapV2.Asset). */
export type RawAsset = { assetType: number; token: Address; id: bigint; amount: bigint };

export function toAsset(raw: RawAsset): Asset | null {
  const kind = KIND[raw.assetType];
  return kind ? { kind, token: raw.token, id: raw.id, amount: raw.amount } : null;
}

/** Back to what the contract's create call takes. */
export const toRawAsset = (a: Asset): RawAsset => ({
  assetType: ASSET_TYPE[a.kind],
  token: a.token,
  id: a.id,
  amount: a.amount,
});

export const nativeAsset = (amount: bigint): Asset => ({
  kind: "native",
  token: zeroAddress,
  id: 0n,
  amount,
});
export const erc20Asset = (token: Address, amount: bigint): Asset => ({
  kind: "erc20",
  token,
  id: 0n,
  amount,
});
export const nftAsset = (token: Address, id: bigint): Asset => ({
  kind: "erc721",
  token,
  id,
  amount: 1n,
});

/** On-chain token facts. Never use a name the maker typed: read these from the token. */
export type TokenInfo = { symbol: string; decimals: number };

/** "12.5 mUSD", "3 MON", "#421". Falls back to a short address while token info is unknown. */
export function formatAsset(asset: Asset, info?: TokenInfo): string {
  if (asset.kind === "native") return formatMon(asset.amount);
  if (asset.kind === "erc721") return `#${asset.id}`;
  const amount = info ? formatUnits(asset.amount, info.decimals) : asset.amount.toString();
  return `${amount} ${info?.symbol ?? `${asset.token.slice(0, 6)}…`}`;
}

/** Same asset regardless of amount: (kind, token, id). The contract's duplicate rule. */
export const sameAsset = (a: Asset, b: Asset) =>
  a.kind === b.kind && a.token.toLowerCase() === b.token.toLowerCase() && a.id === b.id;

/** Distinct ERC-20 token addresses in a list, for one batch of symbol/decimals reads. */
export function erc20Tokens(assets: readonly Asset[]): Address[] {
  return [...new Set(assets.filter((a) => a.kind === "erc20").map((a) => a.token))];
}
