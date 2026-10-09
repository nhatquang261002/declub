import { CHAIN_ID } from "./config";
import { registry as defaultRegistry, type AssetEntry, type AssetTier, type Registry } from "./verifiedAssets";
import type { Asset } from "./assets";

/**
 * How far a screen should trust an asset (ADR 0014): its tier on the curated list, and, for one
 * that isn't on it, the verified asset whose name or symbol it copies. The list is matched by
 * address; the lookalike check is the only place a name or symbol is compared, and only to warn.
 */
export type AssetTrust = {
  tier: AssetTier;
  /** A verified asset this unverified one calls itself after. */
  lookalike: AssetEntry | null;
};

/** What a contract says it's called. Either may be missing while it hasn't answered. */
type Claimed = { name?: string | null; symbol?: string | null };

// Letters from other scripts that render like Latin ones, the usual trick in a fake name.
const HOMOGLYPHS: Record<string, string> = {
  а: "a",
  в: "b",
  с: "c",
  е: "e",
  һ: "h",
  і: "i",
  ј: "j",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  ѕ: "s",
  т: "t",
  у: "y",
  х: "x",
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
};
// Digits standing in for letters: "CH0G", "M0NAD".
const DIGITS: Record<string, string> = { "0": "o", "1": "l", "3": "e", "5": "s", "7": "t" };

/**
 * A name or symbol reduced to what a reader sees at a glance: compatibility forms folded, case and
 * accents dropped, lookalike letters and digits mapped to Latin, spaces and punctuation gone.
 * "Ｃｈоg  NFT!" and "chog-nft" both come out "chognft". Too short to mean anything gives "".
 */
export function glyphKey(text: string | null | undefined): string {
  if (!text) return "";
  const folded = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/./gu, (c) => HOMOGLYPHS[c] ?? DIGITS[c] ?? c)
    .replace(/i/g, "l")
    .replace(/[^a-z0-9]/g, "");
  return folded.length >= 2 ? folded : "";
}

/** The trust of the contract at `token`, given what it claims to be called. */
export function trustOf(token: string, claimed: Claimed, registry: Registry = defaultRegistry, chainId = CHAIN_ID): AssetTrust {
  const tier = registry.tier(token, chainId);
  if (tier !== "unverified") return { tier, lookalike: null };
  const keys = new Set([glyphKey(claimed.name), glyphKey(claimed.symbol)].filter(Boolean));
  if (keys.size === 0) return { tier, lookalike: null };
  const lookalike =
    registry.verified(chainId).find((e) => e.address.toLowerCase() !== token.toLowerCase() && (keys.has(glyphKey(e.name)) || keys.has(glyphKey(e.symbol)))) ??
    null;
  return { tier, lookalike };
}

/** The contract behind an asset, or null for MON. A trait request names its collection. */
export const contractOf = (asset: Asset): string | null => (asset.kind === "native" ? null : asset.token);

/** A side's assets sorted by how much care they need: blocked, lookalikes, then plain unverified. */
export type SideTrust = {
  blocked: Asset[];
  lookalikes: { asset: Asset; of: AssetEntry }[];
  unverified: Asset[];
};

/** `trust` maps a contract (lowercase) to its trust; one not in it yet counts as unverified. */
export function sideTrust(assets: readonly Asset[], trust: ReadonlyMap<string, AssetTrust>): SideTrust {
  const out: SideTrust = { blocked: [], lookalikes: [], unverified: [] };
  for (const asset of assets) {
    const token = contractOf(asset);
    if (!token) continue;
    const t = trust.get(token.toLowerCase()) ?? { tier: "unverified", lookalike: null };
    if (t.tier === "blocked") out.blocked.push(asset);
    else if (t.tier === "unverified") {
      out.unverified.push(asset);
      if (t.lookalike) out.lookalikes.push({ asset, of: t.lookalike });
    }
  }
  return out;
}

/**
 * Why a draft can't be listed: it names a blocked contract (ADR 0014). Only the list's own entry
 * is read, so it answers before any contract does. Null when nothing is blocked.
 */
export function blockedProblem(assets: readonly Asset[], registry: Registry = defaultRegistry, chainId = CHAIN_ID): string | null {
  for (const asset of assets) {
    const token = contractOf(asset);
    if (!token || registry.tier(token, chainId) !== "blocked") continue;
    const entry = registry.entry(token, chainId);
    return `${entry?.symbol ?? `${token.slice(0, 6)}…${token.slice(-4)}`} is on DeClub's blocked list, usually a scam or a copy. Remove it.`;
  }
  return null;
}

/** Nothing on the side needs a second look. */
export const allVerified = (side: SideTrust) => side.blocked.length === 0 && side.unverified.length === 0;
