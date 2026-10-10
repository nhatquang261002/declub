import { formatUnits, toHex, zeroAddress, type Address, type Hex } from "viem";
import { formatMon } from "./format";

/** Mirrors IDeClubEscrow.AssetType. */
export const ASSET_TYPE = { native: 0, erc20: 1, erc721: 2, trait: 3 } as const;
export type AssetKind = "native" | "erc20" | "erc721" | "trait";
/** The kinds a maker can type into a row. A trait request has its own editor. */
export type PlainKind = Exclude<AssetKind, "trait">;
const KIND: Record<number, AssetKind> = { 0: "native", 1: "erc20", 2: "erc721", 3: "trait" };

/**
 * One line of a DeClubEscrow deal side. Native has token 0x0 and id 0; ERC-20 has id 0; ERC-721 has amount 1.
 * A "trait" request (requested side only) names a collection: `id` is the Merkle root of the token
 * ids that satisfy it and `amount` is how many of them the taker hands over (ADR 0006).
 */
export type Asset = {
  kind: AssetKind;
  token: Address;
  id: bigint;
  amount: bigint;
};

/** The shape `getTrade` returns for one asset (IDeClubEscrow.Asset). */
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

export const traitAsset = (token: Address, root: Hex, amount: number): Asset => ({
  kind: "trait",
  token,
  id: BigInt(root),
  amount: BigInt(amount),
});

/** The Merkle root a trait request commits to, as the 32-byte hex the set builder produces. */
export const traitRoot = (asset: Asset): Hex => toHex(asset.id, { size: 32 });

/** On-chain token facts. Never use a name the maker typed: read these from the token. */
export type TokenInfo = { symbol: string; decimals: number };

/** What a search matches a token or NFT collection by. Either may be empty when the contract doesn't answer. */
export type TokenLabel = { symbol: string; name: string };

/** "12.5 mUSD", "3 MON", "#421". Falls back to a short address while token info is unknown. */
export function formatAsset(asset: Asset, info?: TokenInfo): string {
  if (asset.kind === "native") return formatMon(asset.amount);
  if (asset.kind === "erc721") return `#${asset.id}`;
  if (asset.kind === "trait") return `Any ${asset.amount} matching NFT${asset.amount === 1n ? "" : "s"}`;
  const amount = info ? formatUnits(asset.amount, info.decimals) : asset.amount.toString();
  return `${amount} ${info?.symbol ?? `${asset.token.slice(0, 6)}…`}`;
}

/**
 * How many NFTs a side moves: one for each ERC-721 and, for a trait request, as many as it asks
 * for. MON and tokens are not NFTs.
 */
export function nftCount(assets: readonly { kind: AssetKind; amount: bigint }[]): number {
  let n = 0;
  for (const a of assets) {
    if (a.kind === "erc721") n += 1;
    else if (a.kind === "trait") n += Number(a.amount);
  }
  return n;
}

/**
 * What a side's protocol fee is multiplied by (`DeClubEscrow.feeUnits`, ADR 0033): its NFTs, or one
 * if it moves none, so a side with only MON or tokens still pays once.
 */
export const feeUnits = (assets: readonly { kind: AssetKind; amount: bigint }[]): bigint => BigInt(Math.max(nftCount(assets), 1));

/** The protocol fee a side pays: `perNft` for each of its fee units. */
export const sideFee = (perNft: bigint, assets: readonly { kind: AssetKind; amount: bigint }[]): bigint => perNft * feeUnits(assets);

/** Same asset regardless of amount: (kind, token, id). The contract's duplicate rule. */
export const sameAsset = (a: Asset, b: Asset) => a.kind === b.kind && a.token.toLowerCase() === b.token.toLowerCase() && a.id === b.id;

/** Distinct ERC-20 token addresses in a list, for one batch of symbol/decimals reads. */
export function erc20Tokens(assets: readonly Asset[]): Address[] {
  return [...new Set(assets.filter((a) => a.kind === "erc20").map((a) => a.token))];
}
