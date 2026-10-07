import { getAddress, isAddress, type Address, type Hex } from "viem";
import { MAX_NFTS_PER_SIDE, MAX_SPEC_BYTES } from "./config";
import { buildMerkleSet, type MerkleSet } from "./merkle";

/** How many traits one request can combine. The contract doesn't care; the spec's size limit does. */
export const MAX_TRAIT_PICKS = 5;

export type TraitPick = { traitType: string; value: string };
/** "any": the NFT has at least one picked trait (OR). "all": it has every picked trait (AND). */
export type TraitMode = "any" | "all";

/** One trait request: which collection, which traits, how they combine, how many NFTs to hand over. */
export type TraitClause = {
  token: Address;
  mode: TraitMode;
  picks: readonly TraitPick[];
  amount: number;
};

/** A collection's tokens and their traits, as the scan returns them (see /api/collection-traits). */
export type TraitCatalog = {
  /** Every token id with its traits, as `traitKey`s. */
  tokens: readonly { id: bigint; keys: readonly string[] }[];
  /** True when the collection is ERC721Enumerable, so a wallet's tokens can be listed directly. */
  enumerable: boolean;
};

const SEP = "\u001f";
export const traitKey = (pick: TraitPick) => `${pick.traitType}${SEP}${pick.value}`;
export const pickLabel = (pick: TraitPick) => `${pick.traitType}: ${pick.value}`;
export const samePick = (a: TraitPick, b: TraitPick) => a.traitType === b.traitType && a.value === b.value;

/** Every trait type with its values and how many tokens carry each, for the picker. */
export function traitOptions(catalog: TraitCatalog): { traitType: string; values: { value: string; count: number }[] }[] {
  const counts = new Map<string, Map<string, number>>();
  for (const { keys } of catalog.tokens) {
    for (const key of keys) {
      const [traitType, value] = key.split(SEP);
      const values = counts.get(traitType) ?? new Map<string, number>();
      values.set(value, (values.get(value) ?? 0) + 1);
      counts.set(traitType, values);
    }
  }
  return [...counts.entries()]
    .map(([traitType, values]) => ({
      traitType,
      values: [...values.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value)),
    }))
    .sort((a, b) => a.traitType.localeCompare(b.traitType));
}

/** The token ids the clause matches: the set the deal commits to. */
export function matchingIds(catalog: TraitCatalog, clause: Pick<TraitClause, "mode" | "picks">): bigint[] {
  if (clause.picks.length === 0) return [];
  const wanted = clause.picks.map(traitKey);
  return catalog.tokens
    .filter(({ keys }) => {
      const has = new Set(keys);
      return clause.mode === "all" ? wanted.every((k) => has.has(k)) : wanted.some((k) => has.has(k));
    })
    .map(({ id }) => id);
}

export type ResolvedClause = {
  clause: TraitClause;
  ids: bigint[];
  set: MerkleSet;
};

/** The set a clause commits to, with proofs. `set.count` 0 means nothing matches. */
export function resolveClause(catalog: TraitCatalog, clause: TraitClause): ResolvedClause {
  const ids = matchingIds(catalog, clause);
  return { clause, ids, set: buildMerkleSet(ids, clause.token) };
}

// ── The spec the maker publishes on-chain ──────────────────────────────────────────────────────
// `createTraitTrade(..., spec)` stores this text. The contract never reads it: it only proves ids
// are in each Merkle set. A taker's client rebuilds each set from the spec and refuses to offer a
// fill unless the root matches the one in the deal, so a wrong or stale spec can't cause a bad fill.

type SpecClause = { t: string; m: TraitMode; p: [string, string][]; n: number };

/** Compact JSON, one entry per trait asset in `requested`, in order. */
export function encodeSpec(clauses: readonly TraitClause[]): string {
  const body: SpecClause[] = clauses.map((c) => ({
    t: c.token.toLowerCase(),
    m: c.mode,
    p: c.picks.map((p) => [p.traitType, p.value]),
    n: c.amount,
  }));
  return JSON.stringify({ v: 1, c: body });
}

export const specBytes = (text: string) => new TextEncoder().encode(text).length;

/** What is wrong with a set of clauses before it goes on-chain, or null. */
export function clausesError(clauses: readonly TraitClause[], resolved: readonly ResolvedClause[]): string | null {
  if (clauses.length === 0) return null;
  for (const [i, c] of clauses.entries()) {
    const label = clauses.length > 1 ? `Trait request ${i + 1}: ` : "";
    if (!isAddress(c.token)) return `${label}enter a valid collection address.`;
    if (c.picks.length === 0) return `${label}choose at least one trait.`;
    const { ids } = resolved[i];
    if (ids.length === 0) return `${label}no NFT matches. Try "any of" or fewer traits.`;
    if (c.amount < 1 || c.amount > MAX_NFTS_PER_SIDE) return `${label}ask for between 1 and ${MAX_NFTS_PER_SIDE} NFTs.`;
    if (c.amount > ids.length) return `${label}only ${ids.length} NFT${ids.length === 1 ? "" : "s"} match, so you can't ask for ${c.amount}.`;
  }
  for (const [i, a] of resolved.entries()) {
    for (const b of resolved.slice(0, i)) {
      if (a.clause.token.toLowerCase() === b.clause.token.toLowerCase() && a.set.root === b.set.root) {
        return "Two trait requests match exactly the same NFTs. Combine them into one.";
      }
    }
  }
  if (specBytes(encodeSpec(clauses)) > MAX_SPEC_BYTES) return "The trait request is too long to store. Choose fewer traits.";
  return null;
}

/** null unless `text` is a spec this app wrote. Never trust it beyond naming the request. */
export function parseSpec(text: string): TraitClause[] | null {
  try {
    const json = JSON.parse(text) as { v?: unknown; c?: unknown };
    if (json.v !== 1 || !Array.isArray(json.c)) return null;
    const out: TraitClause[] = [];
    for (const raw of json.c as SpecClause[]) {
      if (!raw || !isAddress(raw.t) || (raw.m !== "any" && raw.m !== "all") || !Array.isArray(raw.p)) return null;
      if (!Number.isInteger(raw.n) || raw.n < 1 || raw.n > MAX_NFTS_PER_SIDE) return null;
      const picks = raw.p.map(([traitType, value]) => ({ traitType: String(traitType), value: String(value) }));
      if (picks.length === 0 || picks.length > MAX_TRAIT_PICKS) return null;
      out.push({ token: getAddress(raw.t), mode: raw.m, picks, amount: raw.n });
    }
    return out;
  } catch {
    return null;
  }
}

/** "Hat: Crown or Hat: Halo", "Hat: Crown and Eyes: Gold". */
export function describePicks(clause: Pick<TraitClause, "mode" | "picks">): string {
  return clause.picks.map(pickLabel).join(clause.mode === "all" ? " and " : " or ");
}

/** Whether a clause rebuilt from the published spec commits to the root the deal actually has. */
export function rootMatches(catalog: TraitCatalog, clause: TraitClause, root: Hex): boolean {
  return resolveClause(catalog, clause).set.root.toLowerCase() === root.toLowerCase();
}
