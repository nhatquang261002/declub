import { formatUnits } from "viem";
import { formatMon } from "./format";
import type { Asset, TokenInfo } from "./assets";
import type { DisplayStatus } from "./deals";

/** What a shared deal says about itself: a short title for the link preview, and the post's text. */
export type DealFacts = {
  id: string;
  status: DisplayStatus;
  /** What the maker gives, and what they ask: already worded ("Chog #12, #40", "1.5 MON"). */
  give: string;
  want: string;
  /** An open offer asks nothing: takers send proposals. */
  openOffer: boolean;
};

/** The words for one side: NFTs grouped by collection, then tokens, then MON. */
export function describeAssets(
  assets: readonly Asset[],
  info: ReadonlyMap<string, TokenInfo>,
  nameOf: (token: string) => string | undefined,
): string {
  const parts: string[] = [];
  const nfts = new Map<string, bigint[]>();
  for (const a of assets) {
    const key = a.token.toLowerCase();
    if (a.kind === "erc721") nfts.set(key, [...(nfts.get(key) ?? []), a.id]);
  }
  for (const [token, ids] of nfts) {
    const name = nameOf(token) ?? `${token.slice(0, 6)}…`;
    parts.push(ids.length > 4 ? `${ids.length} ${name}` : `${name} ${ids.map((id) => `#${id}`).join(", ")}`);
  }
  for (const a of assets) {
    if (a.kind === "trait") parts.push(`${a.amount === 1n ? "a" : a.amount} ${nameOf(a.token.toLowerCase()) ?? "NFT"} of a kind`);
    if (a.kind === "erc20") {
      const t = info.get(a.token.toLowerCase());
      parts.push(t ? `${formatUnits(a.amount, t.decimals)} ${t.symbol}` : `${a.token.slice(0, 6)}… tokens`);
    }
    if (a.kind === "native") parts.push(formatMon(a.amount));
  }
  return parts.join(" + ") || "assets";
}

/** The deal in one line, for a link preview's title. */
export function dealTitle(f: DealFacts): string {
  if (f.status === "filled") return f.openOffer ? `Swapped: ${f.give} for an accepted offer` : `Swapped: ${f.give} for ${f.want}`;
  if (f.openOffer) return `Offering ${f.give}, open to offers`;
  return `${f.give} for ${f.want}`;
}

/**
 * What a member posts about a deal. A swap that went through is news; a live offer is an invitation,
 * and `club` is the Club's name when the deal's asset has one, so the post is about it too.
 */
export function dealPost(f: DealFacts, club?: string): string {
  const tail = club ? ` in the ${club} Club` : "";
  if (f.status === "filled") return `${f.openOffer ? `Swapped ${f.give} for an offer I accepted` : `Swapped ${f.give} for ${f.want}`}${tail} on De(al) Club.`;
  if (f.status === "open" && f.openOffer) return `Offering ${f.give}${tail}. Make me an offer:`;
  if (f.status === "open") return `Offering ${f.give} for ${f.want}${tail}. Take it:`;
  return `Deal #${f.id}${tail} on De(al) Club.`;
}

/** The X compose link for a deal post: its text, and the deal's page (whose preview card is the offer). */
export const dealPostLink = (f: DealFacts, dealUrl: string, club?: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(dealPost(f, club))}&url=${encodeURIComponent(dealUrl)}`;
