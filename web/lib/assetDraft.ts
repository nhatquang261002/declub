import { isAddress, parseUnits, type Address } from "viem";
import { MAX_TOKENS_PER_SIDE } from "./config";
import { erc20Asset, nativeAsset, nftAsset, sameAsset, type Asset, type PlainKind } from "./assets";
import { parseMon } from "./format";

/** One row of the create form, as typed. `value` is an amount (MON, token) or a token id (NFT). */
export type DraftRow = { key: string; kind: PlainKind; token: string; value: string };

let counter = 0;
export const newRow = (kind: PlainKind, token = "", value = ""): DraftRow => ({
  key: `row-${++counter}`,
  kind,
  token,
  value,
});

/** ERC-20 addresses typed so far, for one batch of symbol/decimals reads. */
export function draftTokens(rows: readonly DraftRow[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const row of rows) {
    const token = row.token.trim();
    if (row.kind !== "erc20" || !isAddress(token) || seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    out.push(token);
  }
  return out;
}

/** "1.5" → 1500000n at 6 decimals. Empty, zero, negative or too precise → null. */
function parseAmount(input: string, decimals: number): bigint | null {
  const value = input.trim();
  if (!/^\d*\.?\d*$/.test(value) || value === "" || value === ".") return null;
  // parseUnits rounds extra digits instead of failing, which would change what the user typed.
  if ((value.split(".")[1]?.length ?? 0) > decimals) return null;
  try {
    const amount = parseUnits(value, decimals);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

export type SideResult = { assets: Asset[]; errors: string[] };

/**
 * Turns typed rows into contract-ready assets, or says what is wrong with which row. The rules
 * mirror ChogSwapV2's validation so the contract's reverts are a backstop, not the UI.
 * `decimalsOf` comes from the token contract itself (useTokenInfo), never from the user.
 */
export function draftToAssets(
  rows: readonly DraftRow[],
  decimalsOf: (token: Address) => number | undefined,
  { optional = false, noNative = false }: { optional?: boolean; noNative?: boolean } = {},
): SideResult {
  const assets: Asset[] = [];
  const errors: string[] = [];

  if (rows.length === 0 && !optional) errors.push("Add at least one asset.");
  if (rows.length > MAX_TOKENS_PER_SIDE) errors.push(`Up to ${MAX_TOKENS_PER_SIDE} assets per side.`);

  rows.forEach((row, i) => {
    const label = `Row ${i + 1}`;
    const token = row.token.trim();

    if (row.kind === "native") {
      if (noNative) return errors.push(`${label}: MON can't be used here. Wrap it as WMON and use that token.`);
      const amount = parseMon(row.value);
      if (!amount) return errors.push(`${label}: enter a MON amount above zero.`);
      assets.push(nativeAsset(amount));
      return;
    }

    if (row.kind === "erc721" && token === "" && row.value.trim() === "") return errors.push(`${label}: choose an NFT.`);
    if (!isAddress(token)) return errors.push(`${label}: enter a valid ${row.kind === "erc20" ? "token" : "collection"} address.`);

    if (row.kind === "erc20") {
      const decimals = decimalsOf(token);
      if (decimals === undefined) return errors.push(`${label}: that address is not a readable token.`);
      const amount = parseAmount(row.value, decimals);
      if (!amount) return errors.push(`${label}: enter an amount above zero (up to ${decimals} decimals).`);
      assets.push(erc20Asset(token, amount));
      return;
    }

    if (!/^\d+$/.test(row.value.trim())) return errors.push(`${label}: choose an NFT.`);
    assets.push(nftAsset(token, BigInt(row.value.trim())));
  });

  for (let i = 0; i < assets.length; i++) {
    if (assets.slice(0, i).some((earlier) => sameAsset(earlier, assets[i]))) {
      errors.push("The same asset is listed twice on one side. Combine the amounts into one row.");
      break;
    }
  }
  return { assets, errors };
}

/** The same asset on both sides can never be filled, and the contract rejects it (MON for MON too). */
export function overlapError(offered: readonly Asset[], requested: readonly Asset[]): string | null {
  const clash = offered.some((a) => requested.some((b) => sameAsset(a, b)));
  return clash ? "The same asset can't be on both sides. Offer and request different assets." : null;
}
